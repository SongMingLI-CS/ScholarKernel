import { stepCountIs, streamText, type ToolSet } from "ai"
import { clampReasoningPrompt } from "@/lib/tools/academic-search-strategy"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import { ACADEMIC_OUTPUT_DISCIPLINE, REASONING_TOOL_BOUNDARY, type WorkflowNode } from "@/lib/agent/planner"
import type { AgentExecutorDeps, AgentExecutorHooks, LlmHistoryMessage, SubtaskResult } from "@/lib/agent/executor-types"
import {
  REASONING_TOOL_LOOP_STEPS,
  asRecord,
  buildGenModelForCloudInference,
  buildReasoningOutputTokenBudget,
  consumeStreamTextOutput,
  llmCallSettings,
  logLlmCallFailure,
  normalizeModelId,
  providerSelfIntro,
  serializeSubtaskForReasoning,
  type StreamTextCallExtras,
} from "@/lib/agent/llm-utils"

export type ReasoningNodeContext = {
  node: WorkflowNode
  deps: AgentExecutorDeps
  hooks: Pick<AgentExecutorHooks, "onNodePatch" | "onNodeLog" | "onStreamFlush">
  userInput: string
  nodes: WorkflowNode[]
  results: SubtaskResult[]
  sources: AcademicSearchHit[]
  citationsMarkdown: string
  tools: ToolSet
  runtimeKeys: AgentExecutorDeps["runtimeKeys"] | undefined
  inference: { temperature?: number; maxTokens?: number; contextLimit?: number }
  buildConversationMessages: (currentUserInput: string, currentUserContent: string) => LlmHistoryMessage[]
  nodeStartedAt: number
}

export async function executeReasoningNode(ctx: ReasoningNodeContext): Promise<SubtaskResult> {
  const {
    node: n,
    deps,
    hooks,
    userInput,
    nodes,
    results,
    sources,
    citationsMarkdown,
    tools,
    runtimeKeys,
    inference: inf,
    buildConversationMessages,
    nodeStartedAt,
  } = ctx

  const active = deps.activeProvider
  const normalizedModel = normalizeModelId(active.providerId, active.model)

  const hasCollectionNodes = nodes.some((x) => x.type === "research" || x.type === "read_file")
  if (hasCollectionNodes) {
    const anyCollectionOk = results.some(
      (r) => r.ok && (r.summary.includes("学术检索") || r.summary.startsWith("读取 "))
    )
    const anySources = Array.isArray(sources) && sources.length > 0
    const anyReadText = results.some((r) => {
      const rec = asRecord(r.output)
      const t = typeof rec["text"] === "string" ? String(rec["text"]) : undefined
      return r.ok && typeof t === "string" && t.trim().length > 0
    })
    const anySearchEmptyFeedback = results.some((r) => {
      const rec = asRecord(r.output)
      return (
        rec["status"] === "empty" ||
        rec["status"] === "failed" ||
        r.summary.includes("status=empty") ||
        r.summary.includes("status=failed")
      )
    })

    if (!anyCollectionOk && !anySources && !anyReadText && !anySearchEmptyFeedback) {
      const text = [
        "【DiagnosticReasoning】",
        "",
        "未能获取到有效参考资料，无法生成带实时引用的综述。",
        "",
        "可能原因：",
        "- 检索 Key 缺失/无权限",
        "- 网络/代理/CORS 拦截导致检索失败",
        "- read_file 参数缺失、路径不存在或 Source API 不可用",
        "",
        "建议操作：",
        "- 配置并解锁检索 Key（Tavily/Serper）后重试",
        '- 或明确给出需要读取的文件路径（例如 "src/xxx.ts"）',
        "- 或允许我仅基于内部知识给出不带实时引用的概览（会在开头明确无法获取实时/本地数据）",
      ].join("\n")

      hooks.onNodePatch?.(n.id, {
        status: "done",
        output: { text },
        metadata: {
          durationMs: Math.round(performance.now() - nodeStartedAt),
          guardrail: "no-evidence",
          diagnosticReasoning: true,
        },
      })
      return { id: n.id, ok: false, summary: "无有效采集结果，拒绝空综述", output: { text } }
    }
  }

  const inferNode: WorkflowNode =
    n.provider === "local"
      ? {
          ...n,
          provider: "cloud",
          metadata: {
            ...n.metadata,
            inferenceModel:
              active.providerId !== "ollama"
                ? normalizedModel
                : ((n.metadata?.["inferenceModel"] as string | undefined) ?? "deepseek-chat"),
          },
        }
      : n
  const model = buildGenModelForCloudInference(active, runtimeKeys, inferNode)

  hooks.onNodeLog?.(n.id, "开始流式推理：streamText(...)")
  hooks.onStreamFlush?.({ nodeId: n.id, reason: "pre-reasoning-stream" })
  let sawFirst = false

  const sys = [
    providerSelfIntro(active),
    "",
    "你是 ScholarKernel-Agent 的执行器。",
    "你会使用 tools 来完成审计或综述，再把结果整合为对用户的最终回答。",
    "messages 含完整对话历史；若用户引用上一轮（如「总结上一篇论文」「详解刚才那篇论文」），须从历史 assistant 摘要/参考文献作答，或调用 academicSearch 用完整标题重新检索。",
    "输出给用户的最终回答必须是中文。",
    "",
    REASONING_TOOL_BOUNDARY,
    "",
    "诊断策略（必须遵守）：",
    "- 如果是在分析 API 连接/鉴权/CORS/网络错误：优先分析“内存中的原始错误对象”（例如子任务结果里的 error_info、用户界面提供的错误描述/状态码），不要先去读物理日志文件。",
    '- 只有在用户明确要求“读取某个日志文件”时，才调用 readLocalFile(path="logs/xxx.log")。',
    "",
    "降级约束（必须遵守）：",
    "如果 academicSearch（检索）或 read_file（读取）出现错误/异常，请根据你自身的知识库（Internal Knowledge）进行推理，",
    "并在回复开头明确告知用户：由于网络/权限/物理限制无法获取实时数据或无法读取本地文件，本次回答基于内部知识与已有上下文。",
    "若子任务结果中包含 read_file 降级提示（未能直接读取该文献的全文），必须基于上一轮召回的摘要与已有上下文继续推导，禁止再次尝试 readLocalFile 读取论文标题或 URL。",
    "若子任务结果中 search_status 为 empty 或 failed，必须向用户明确说明「检索未找到相关文献」并给出可操作的换词建议（优先纯英文专业术语），禁止假装已检索到论文。",
    "",
    "学术严谨性（必须遵守）：",
    "- 当你引用本次检索到的文献时，必须在对应观点后用 [1] [2] 这样的编号标注引用（与 References 列表编号一致）。",
    '- 最后必须输出一个 "## 参考文献 (References)" 小节，汇总本次对话中用到的文献（与 [n] 编号一致）。',
    "",
    ACADEMIC_OUTPUT_DISCIPLINE,
  ].join("\n")

  const prompt = clampReasoningPrompt(
    [
      "【当前系统配置（必须据此回答身份相关问题）】",
      `providerId: ${active.providerId}`,
      `model: ${normalizedModel}`,
      `baseUrl: ${active.baseUrl ?? "(default)"}`,
      "",
      "用户需求：",
      userInput,
      citationsMarkdown ? ["", "已检索到的参考文献（完整保留，禁止省略 URL）：", citationsMarkdown].join("\n") : "",
      "",
      "已完成子任务结果（JSON）：",
      JSON.stringify(results.map(serializeSubtaskForReasoning), null, 2),
      "",
      "你可以：",
      "- 如果需要长综述，调用 globalLiteratureReview(topic, constraints)",
      "- 如果需要源码审计，调用 localSourceAudit(path|content, focus)",
      "- 如果需要全球检索，调用 academicSearch(search_query, academicOnly) 或对宽泛主题使用 search_queries 数组",
    ].join("\n"),
    inf.contextLimit
  )

  const reasoningMessages = buildConversationMessages(userInput, prompt)

  const streamed = await streamText({
    model,
    temperature: inf.temperature ?? 0.35,
    tools,
    system: sys,
    messages: reasoningMessages,
    ...llmCallSettings(deps.signal),
    maxOutputTokens: buildReasoningOutputTokenBudget(inf.maxTokens),
    stopWhen: stepCountIs(REASONING_TOOL_LOOP_STEPS),
    ...({ experimental_continueOnLimit: true } satisfies StreamTextCallExtras),
    onFinish: () => {
      hooks.onStreamFlush?.({ nodeId: n.id, reason: "stream-finished" })
    },
    onError: ({ error }) => {
      logLlmCallFailure(`run: node ${n.id} stream onError`, error)
      hooks.onStreamFlush?.({ nodeId: n.id, reason: "stream-error" })
    },
  })

  let acc = ""
  acc = await consumeStreamTextOutput(
    streamed,
    (text) => {
      if (!sawFirst && text.length > 0) {
        sawFirst = true
        hooks.onNodeLog?.(n.id, "首个 token 已到达 (TTFT)")
      }
      acc = text
      hooks.onNodePatch?.(n.id, { output: { text: acc } })
    },
    deps.signal
  )

  hooks.onNodePatch?.(n.id, {
    status: "done",
    output: { text: acc },
    metadata: { durationMs: Math.round(performance.now() - nodeStartedAt) },
  })
  return { id: n.id, ok: true, summary: "推理整合完成", output: { text: acc } }
}
