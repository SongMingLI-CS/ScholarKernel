import { generateText, tool, zodSchema, type ToolSet } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOllama } from "ai-sdk-ollama"
import { z } from "zod"
import {
  DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS,
  mergeAcademicSearchHits,
  mergeAcademicSearchResponses,
  RERANK_FINAL_TOP_K,
  resolveResearchQueryList,
} from "@/lib/tools/academic-search-strategy"
import {
  createAcademicSearchTool,
  resolveSearchApiKeys,
  synthesizeCitationsMarkdown,
  type AcademicSearchHit,
  type AcademicSearchResponse,
} from "@/lib/tools/search-tool"
import { createFileTool } from "@/lib/tools/file-tool"
import { isAbortError } from "@/lib/run-abort"
import { streamDirectChat } from "@/lib/agent/direct-chat"
import { executePeerReviewGroup, isPeerReviewGroupStart, collectPeerReviewGroup } from "@/lib/agent/peer-review-runner"
import { executeReasoningNode } from "@/lib/agent/reasoning-runner"
import type { AgentExecutorDeps, AgentExecutorHooks, ChatHistoryEntry, LlmHistoryMessage } from "@/lib/agent/executor-types"
export type { AgentExecutorDeps, AgentExecutorHooks, ChatHistoryEntry, LlmHistoryMessage } from "@/lib/agent/executor-types"
import {
  ACADEMIC_OUTPUT_DISCIPLINE,
  applyCloudOnlyWorkflowNormalization,
  buildFallbackSearchQuery,
  buildPaperDetailSearchQuery,
  correctMisplacedReadFileNodes,
  ensureMultiSourceResearchPlan,
  ensurePeerReviewPlan,
  isDirectChatInput,
  needsPaperDetailIntent,
  needsResearchIntent,
  parseAndValidateTaskList,
  PLAN_QUERY_OPTIMIZATION,
  PLAN_TOOL_BOUNDARY,
  PLAN_TOOL_ENFORCEMENT,
  READ_FILE_LITERATURE_FALLBACK,
  type WorkflowNode,
} from "@/lib/agent/planner"
import {
  PROXY_SDK_FETCH,
  assertNotAborted,
  asRecord,
  buildLlmMessages,
  clampTextByChars,
  createPlanningFetch,
  extractLlmHistory,
  formatPlanCrashDetail,
  formatResearchResultsForSessionContext,
  generatePlanTextWithStructuredFallback,
  isBrowser,
  isNetworkishError,
  isReadFileNotFoundError,
  keyForActiveProvider,
  llmCallSettings,
  logLlmCallFailure,
  normalizeModelId,
  normalizeOpenAICompatBaseUrlWithProxy,
  providerSelfIntro,
  readSourceText,
  rewriteResearchSearchQuery,
  runtimeKeysFromEnv,
  trimHistoryToContextLimit,
  type GenModel,
} from "@/lib/agent/llm-utils"
import { recordLlmUsageAsync, recordSearchUsageAsync } from "@/lib/billing/token-usage-bridge"
import {
  buildNodeSnapshotRecord,
  findTargetNodeIndex,
  prepareNodesForPartialResume,
  restoreExecutionStateFromSnapshots,
  shouldSkipNodeForResume,
  snapshotMap,
} from "@/lib/agent/node-resume"
export {
  buildChatHistoryForExecutor,
  extractLlmHistory,
} from "@/lib/agent/llm-utils"

export {
  WorkflowPlanParseError,
  interceptWorkflowPlanInAssistantBubble,
  isDirectChatInput,
  parsePlan,
  type ActiveProviderConfig,
  type ActiveProviderId,
  type WorkflowNode,
  type WorkflowProvider,
  type WorkflowStatus,
  type WorkflowTaskType,
} from "@/lib/agent/planner"


export class AgentExecutor {
  /** 本轮 run 内由工具节点写入的临时会话上下文（research 结果等），与 getChatHistory 合并。 */
  private sessionContextMessages: ChatHistoryEntry[] = []

  constructor(
    private deps: AgentExecutorDeps,
    private hooks: AgentExecutorHooks = {}
  ) {}

  private throwIfAborted() {
    assertNotAborted(this.deps.signal)
  }

  private llmSettings() {
    return llmCallSettings(this.deps.signal)
  }

  private effectiveRuntimeKeys() {
    const latest = this.deps.getRuntimeKeys?.() ?? undefined
    // latest takes precedence; fall back to constructor-injected snapshot
    const rk = (latest ?? this.deps.runtimeKeys) ?? undefined
    if (isBrowser()) {
      return rk
    }
    // env fallback (server-side only) for seamless local dev / CI
    if (rk && Object.values(rk ?? {}).some((v) => typeof v === "string" && v.trim().length > 0)) return rk
    const env = runtimeKeysFromEnv()
    return Object.values(env).some((v) => typeof v === "string" && v.trim().length > 0) ? env : rk
  }

  private effectiveSearchKeys() {
    if (this.deps.localOnly) {
      return resolveSearchApiKeys({})
    }
    const rk = this.effectiveRuntimeKeys()
    return resolveSearchApiKeys({
      tavilyApiKey: rk?.tavily ?? this.deps.search?.tavilyApiKey,
      serperApiKey: rk?.serper ?? this.deps.search?.serperApiKey,
    })
  }

  private inferenceCfg() {
    const t = this.deps.inference?.temperature
    const mt = this.deps.inference?.maxTokens
    const cl = this.deps.inference?.contextLimit
    return {
      temperature: typeof t === "number" && Number.isFinite(t) ? Math.max(0, Math.min(2, t)) : undefined,
      // NOTE: `ai` SDK v6's `generateText` CallSettings doesn't expose a stable maxTokens option
      // across providers in our current setup. Keep it in settings for future wiring.
      maxTokens: typeof mt === "number" && Number.isFinite(mt) ? Math.max(1, Math.floor(mt)) : undefined,
      contextLimit: typeof cl === "number" && Number.isFinite(cl) ? Math.max(0, Math.floor(cl)) : undefined,
    }
  }

  /** 构造含完整历史链条的 messages（system 由调用方单独传入）。 */
  private buildConversationMessages(currentUserInput: string, currentUserContent: string): LlmHistoryMessage[] {
    const rawMessages = this.getMergedChatHistory()
    const raw = rawMessages.length ? rawMessages : []
    const history = trimHistoryToContextLimit(
      extractLlmHistory(raw, currentUserInput),
      currentUserContent,
      this.inferenceCfg().contextLimit
    )
    return buildLlmMessages(history, currentUserContent)
  }

  private getMergedChatHistory(): ChatHistoryEntry[] {
    const base = this.deps.getChatHistory?.() ?? []
    if (!this.sessionContextMessages.length) return base
    return [...base, ...this.sessionContextMessages]
  }

  private pushResearchIntoSessionContext(out: AcademicSearchResponse, citationsMarkdown: string, nodeId: string) {
    const cl = this.inferenceCfg().contextLimit
    const blockBudget =
      typeof cl === "number" && Number.isFinite(cl) && cl > 0 ? Math.min(Math.floor(cl * 0.45), 32_000) : 32_000
    const content = clampTextByChars(formatResearchResultsForSessionContext(out, citationsMarkdown), blockBudget)
    this.sessionContextMessages.push({ role: "assistant", content })
    this.hooks.onResearchResultsSynced?.({
      nodeId,
      sources: Array.isArray(out.results) ? out.results : [],
      citationsMarkdown,
    })
  }

  async plan(userInput: string, opts?: { retryMessage?: string }): Promise<WorkflowNode[]> {
    this.throwIfAborted()
    try {
    console.log("Plan starting with provider:", this.deps.activeProvider.providerId)
    const inf = this.inferenceCfg()
    const planPrompt =
      opts?.retryMessage?.trim()
        ? `${userInput.trim()}\n\n---\n${opts.retryMessage.trim()}`
        : userInput.trim()
    const planMessages = this.buildConversationMessages(userInput, planPrompt)
    const strictJsonLine = "Output ONLY raw JSON. No markdown blocks. No explanations."
    const rules = [
      "每个子任务必须符合协议：{ id, type: read_file|reasoning|audit|research|peer_review, provider: cloud, status }。",
      'All tasks in the "tasks" array MUST use "provider": "cloud". Do not use "local" under any circumstances.',
      "OUTPUT ONLY RAW JSON. NO CONVERSATIONAL TEXT.",
      PLAN_TOOL_ENFORCEMENT,
      PLAN_QUERY_OPTIMIZATION,
      PLAN_TOOL_BOUNDARY,
      "约束：",
      "- 对于“学术综述/Survey/Review/核心进展/对比论文”类任务：必须规划两个 research 节点（Survey 向 + Methodology 向），见【多源聚合】",
      "- 用户要求「详解/深入分析上一轮某篇论文」时：必须从 messages 历史 assistant 的参考文献中提炼论文完整英文标题，规划 research 节点重新检索；严禁 read_file",
      "- 只有当任务明确涉及本地项目/具体文件/代码问题时，才使用 read_file（必须提供 input.path，且必须是本地源码路径如 src/...）",
      "- 优先把“读文件/抓上下文”拆成 read_file（但不要为了凑步骤而读文件）",
      "- 推理整合用 reasoning",
      "- 代码或安全审计用 audit",
      "- 需要全球资料检索/论文对比/最新信息时，用 research（会调用 academicSearch）",
      "- 用户提交论文摘要/实验设计或要求模拟审稿时，用 peer_review（系统将并行派生 Reviewer #1/#2 激辩并由 Area Chair 汇总）",
      "- 所有子任务的 provider 必须为 cloud（不得输出 local）",
      "- status 初始必须是 pending",
      '- id 必须为字符串（例如 "1"、"read-1"）；若你使用数字 id，系统会自动转为字符串。',
    ].join("\n")

    const sysTextArray = [
      "你是 ScholarKernel-Agent 的任务编排器。",
      "把用户输入拆成可执行的子任务序列。",
      "messages 含完整对话历史；最后一条 user 为当前待规划输入。若用户引用上一轮（如「总结上一篇论文」「详解刚才那篇 SELF 论文」），须从历史 assistant 的参考文献 [n] 标题提炼 search_query，规划 research 而非 read_file。",
      "仅输出 JSON：允许为 JSON 数组，或形如 {\"tasks\":[...]} 的 JSON 对象（不要输出任何额外文字）。",
      strictJsonLine,
      rules,
      "",
      "One-shot example (copy the style; output JSON only):",
      `[{"id":"research-1","type":"research","provider":"cloud","status":"pending","title":"学术检索","input":{"search_query":"SELF: Simple Efficient Language Model full paper arxiv","academicOnly":true}},{"id":"reason-1","type":"reasoning","provider":"cloud","status":"pending","title":"整合并给出结论"}]`,
    ].join("\n")

    const sysJsonObject = [
      "你是 ScholarKernel-Agent 的任务编排器。",
      "把用户输入拆成可执行的子任务序列。",
      "messages 含完整对话历史；最后一条 user 为当前待规划输入。若用户引用上一轮（如「总结上一篇论文」「详解刚才那篇 SELF 论文」），须从历史 assistant 的参考文献 [n] 标题提炼 search_query，规划 research 而非 read_file。",
      "仅输出一个 JSON 对象，且顶层必须包含 tasks 数组字段：{\"tasks\":[ ... ]}。",
      "除 JSON 外不要输出任何字符（不要 Markdown、不要解释、不要前后缀）。",
      strictJsonLine,
      rules,
      "",
      "One-shot example (copy the shape; output JSON only):",
      `{"tasks":[{"id":"research-1","type":"research","provider":"cloud","status":"pending","title":"学术检索","input":{"search_query":"SELF: Simple Efficient Language Model full paper arxiv","academicOnly":true}},{"id":"reason-1","type":"reasoning","provider":"cloud","status":"pending","title":"整合并给出结论"}]}`,
    ].join("\n")

    const rk = this.effectiveRuntimeKeys()
    const dsKey = rk?.deepseek?.trim()
    const active = this.deps.activeProvider

    let planHttpErrorEmitted = false
    const planningFetch = createPlanningFetch((msg) => {
      if (planHttpErrorEmitted) return
      planHttpErrorEmitted = true
      this.hooks.onPlanHttpError?.(msg)
    }, this.deps.signal)

    const planningIntroDeepSeek = providerSelfIntro({
      providerId: "deepseek_openai_compat",
      model:
        active.providerId === "deepseek_openai_compat"
          ? normalizeModelId(active.providerId, active.model)
          : "deepseek-chat",
      baseUrl: active.providerId === "deepseek_openai_compat" ? active.baseUrl : undefined,
    })

    let planGen: Awaited<ReturnType<typeof generateText>>
    let usesStructuredJson = false

    if (dsKey) {
      const planModel = "deepseek-chat"
      const planBaseForDs = active.providerId === "deepseek_openai_compat" ? active.baseUrl : undefined
      const openai = createOpenAI({
        apiKey: dsKey,
        baseURL: normalizeOpenAICompatBaseUrlWithProxy(planBaseForDs, "deepseek_openai_compat"),
        fetch: planningFetch,
      })
      const model = openai.chat(planModel)
      const planResult = await generatePlanTextWithStructuredFallback({
        context: "plan: DeepSeek",
        model,
        systemStructured: `${sysJsonObject}\n\n${planningIntroDeepSeek}`,
        systemPlain: `${sysTextArray}\n\n${planningIntroDeepSeek}`,
        messages: planMessages,
        temperature: inf.temperature ?? 0.2,
        signal: this.deps.signal,
      })
      planGen = planResult.gen
      usesStructuredJson = planResult.usesStructuredJson
    } else if (active.providerId !== "ollama") {
      const apiKey = keyForActiveProvider(rk, active.providerId)?.trim()
      if (!apiKey) throw new Error("MissingApiKey")

      usesStructuredJson = active.providerId === "openai" || active.providerId === "deepseek_openai_compat"

      if (active.providerId === "anthropic") {
        const provider = createAnthropic({ apiKey, baseURL: active.baseUrl, fetch: planningFetch })
        const model = provider(normalizeModelId(active.providerId, active.model))
        planGen = await generateText({
          model,
          system: `${sysTextArray}\n\n${providerSelfIntro(active)}`,
          messages: planMessages,
          temperature: inf.temperature ?? 0.2,
          ...this.llmSettings(),
        })
      } else if (active.providerId === "google") {
        const provider = createGoogleGenerativeAI({ apiKey, baseURL: active.baseUrl, fetch: planningFetch })
        const model = provider(normalizeModelId(active.providerId, active.model))
        planGen = await generateText({
          model,
          system: `${sysTextArray}\n\n${providerSelfIntro(active)}`,
          messages: planMessages,
          temperature: inf.temperature ?? 0.2,
          ...this.llmSettings(),
        })
      } else if (active.providerId === "openai" || active.providerId === "deepseek_openai_compat") {
        const provider = createOpenAI({
          apiKey,
          baseURL: normalizeOpenAICompatBaseUrlWithProxy(active.baseUrl, active.providerId),
          fetch: planningFetch,
        })
        const model = provider.chat(normalizeModelId(active.providerId, active.model))
        const planResult = await generatePlanTextWithStructuredFallback({
          context: "plan: active cloud",
          model,
          systemStructured: `${sysJsonObject}\n\n${providerSelfIntro(active)}`,
          systemPlain: `${sysTextArray}\n\n${providerSelfIntro(active)}`,
          messages: planMessages,
          temperature: inf.temperature ?? 0.2,
          signal: this.deps.signal,
        })
        planGen = planResult.gen
        usesStructuredJson = planResult.usesStructuredJson
      } else {
        throw new Error("UnsupportedProvider")
      }
    } else {
      throw new Error("MissingApiKey")
    }

    const content = planGen.text ?? ""
    console.log("🔥🔥🔥 RAW_LLM_OUTPUT:", content)
    if (usesStructuredJson && planGen.output != null) {
      console.log("🔥🔥🔥 RAW_LLM_OUTPUT (structured):", planGen.output)
    }

    const planModelUsed =
      dsKey
        ? "deepseek-chat"
        : normalizeModelId(active.providerId, active.model)
    recordLlmUsageAsync(this.deps, planModelUsed, planGen.usage)

    const list = usesStructuredJson
      ? parseAndValidateTaskList(planGen.text, planGen.output as unknown)
      : parseAndValidateTaskList(planGen.text)

    let nodes: WorkflowNode[] = list.map((t) => ({
      id: t.id,
      type: t.type,
      provider: "cloud",
      status: t.status ?? "pending",
      title: t.title,
      input: t.input,
      logs: [],
      metadata: t.metadata,
    }))

    // heuristic: research-first when user asks for search/paper intent
    const needResearch = needsResearchIntent(userInput)
    const hasResearch = nodes.some((n) => n.type === "research")
    const rawLooksConversational =
      !/[\[{]/.test(content) && /好的|我来|让我|正在|搜索|检索|帮你查/i.test(content)

    if (needResearch && !hasResearch) {
      const history = this.deps.getChatHistory?.() ?? []
      const fallbackQuery = buildFallbackSearchQuery(userInput, history)
      if (rawLooksConversational) {
        console.warn("⚠️ 规划输出疑似口嗨自然语言，强制注入 research 节点")
      }
      nodes = [
        {
          id: "research-1",
          type: "research",
          provider: "cloud",
          status: "pending",
          title: "全球检索 (Global Search)",
          input: { search_query: fallbackQuery, academicOnly: true },
          logs: [],
          metadata: { kind: "auto-research", queryExpanded: fallbackQuery !== userInput.trim() },
        },
        ...nodes,
      ]
    }

    const historyForCorrection = this.deps.getChatHistory?.() ?? []
    nodes = correctMisplacedReadFileNodes(nodes, userInput, historyForCorrection)
    nodes = ensureMultiSourceResearchPlan(nodes, userInput)
    nodes = ensurePeerReviewPlan(nodes, userInput)

    if (needsPaperDetailIntent(userInput) && !nodes.some((n) => n.type === "research")) {
      const paperQuery =
        buildPaperDetailSearchQuery(userInput, historyForCorrection) ??
        buildFallbackSearchQuery(userInput, historyForCorrection)
      console.warn("⚠️ 用户要求详解上一轮论文但未规划 research，强制注入检索节点")
      nodes = [
        {
          id: "research-paper-detail-1",
          type: "research",
          provider: "cloud",
          status: "pending",
          title: "重新检索论文详情",
          input: { search_query: paperQuery, academicOnly: true },
          logs: [],
          metadata: { kind: "auto-research", queryExpanded: true, paperDetailFollowUp: true },
        },
        ...nodes,
      ]
    }

    nodes = applyCloudOnlyWorkflowNormalization(nodes, active)

    this.hooks.onWorkflowPlanned?.(nodes)
    return nodes
    } catch (error) {
      if (isAbortError(error)) throw error
      console.error("🔥🔥🔥 PLAN_CRASH_REASON:", error)
      console.error("🔥 PLAN_CRASH_DETAIL:", formatPlanCrashDetail(error))
      const history = this.deps.getChatHistory?.() ?? []
      const fallbackQuery = buildFallbackSearchQuery(userInput, history)
      const crashNodes: WorkflowNode[] = needsResearchIntent(userInput)
        ? [
            {
              id: "research-crash-1",
              type: "research",
              provider: "cloud",
              status: "pending",
              title: "规划失败兜底检索",
              input: { search_query: fallbackQuery, academicOnly: true },
              logs: [],
              metadata: { fallback: true, fallbackReason: "plan_crash" },
            },
            {
              id: "force-1",
              type: "reasoning",
              provider: "cloud",
              status: "pending",
              title: "整合检索结果并回答",
              input: { query: userInput },
              logs: [],
              metadata: { fallback: true, fallbackReason: "plan_crash" },
            },
          ]
        : [
            {
              id: "force-1",
              type: "reasoning",
              provider: "cloud",
              status: "pending",
              title: "直接解答问题",
              input: { query: "系统未规划明确任务，请直接根据内置知识回答用户。" },
              logs: [],
              metadata: { fallback: true, fallbackReason: "plan_crash" },
            },
          ]
      const forceNodes = applyCloudOnlyWorkflowNormalization(crashNodes, this.deps.activeProvider)
      this.hooks.onWorkflowPlanned?.(forceNodes)
      return forceNodes
    }
  }

  private buildTools(): ToolSet {
    const inf = this.inferenceCfg()
    const localSourceAudit = tool({
      description:
        "使用本地 Ollama 对项目源码做行级审计。仅用于本地 path（如 src/app/page.tsx）或用户粘贴的源码 content；严禁用于论文标题、URL 或在线文献。",
      inputSchema: zodSchema(
        z.object({
        path: z.string().optional(),
        content: z.string().optional(),
        focus: z.string().optional(),
        })
      ),
      execute: async ({ path, content, focus }: { path?: string; content?: string; focus?: string }) => {
        const src =
          content ??
          (path && this.deps.sourceApiBase ? await readSourceText(this.deps.sourceApiBase, path) : null)
        if (!src) throw new Error("MissingSourceContent")

        const provider = createOllama({ baseURL: this.deps.activeProvider.baseUrl })
        const model = provider(this.deps.activeProvider.model)
        const auditModel = this.deps.activeProvider.model
        const auditGen = await generateText({
          model,
          ...llmCallSettings(this.deps.signal),
          temperature: Math.min(inf.temperature ?? 0.1, 0.2),
          system: [
            "你是严谨的代码审计助手。",
            "输出结构化要点：",
            "- 发现（按严重度排序）",
            "- 证据（引用行号范围）",
            "- 修复建议（可执行）",
            "要求：中文，尽量精炼。",
          ].join("\n"),
          prompt: [
            `Focus: ${focus ?? "general"}`,
            `Path: ${path ?? "(inline)"}`,
            "---- SOURCE ----",
            clampTextByChars(src, inf.contextLimit),
          ].join("\n"),
        })
        recordLlmUsageAsync(this.deps, auditModel, auditGen.usage)
        return { ok: true, path, focus, report: auditGen.text }
      },
    })

    const globalLiteratureReview = tool({
      description: "调用当前云端模型进行长上下文学术综述（带引用风格小节）。",
      inputSchema: zodSchema(
        z.object({
          topic: z.string(),
          constraints: z.string().optional(),
        })
      ),
      execute: async ({ topic, constraints }: { topic: string; constraints?: string }) => {
        const active = this.deps.activeProvider
        if (active.providerId === "ollama") throw new Error("CloudOnlyTool")

        const apiKey = keyForActiveProvider(this.effectiveRuntimeKeys(), active.providerId)?.trim()
        if (!apiKey) throw new Error("MissingApiKey")

        let model: GenModel
        const normalizedModel = normalizeModelId(active.providerId, active.model)
        if (active.providerId === "anthropic") {
          model = createAnthropic({ apiKey, baseURL: active.baseUrl, fetch: PROXY_SDK_FETCH })(normalizedModel)
        } else if (active.providerId === "google") {
          model = createGoogleGenerativeAI({ apiKey, baseURL: active.baseUrl, fetch: PROXY_SDK_FETCH })(normalizedModel)
        } else if (active.providerId === "openai" || active.providerId === "deepseek_openai_compat") {
          model = createOpenAI({
            apiKey,
            fetch: PROXY_SDK_FETCH,
            baseURL: normalizeOpenAICompatBaseUrlWithProxy(active.baseUrl, active.providerId),
          }).chat(normalizedModel)
        } else {
          throw new Error("UnsupportedProvider")
        }

        const reviewGen = await generateText({
          model,
          ...llmCallSettings(this.deps.signal),
          temperature: inf.temperature ?? 0.4,
          system: [
            "你是资深科研助理，擅长学术综述写作。",
            "输出结构：背景/关键脉络/代表方法与优缺点/开放问题/建议阅读（以作者-年份风格列点，不要求真实 DOI）。",
            "中文，逻辑严密，避免空话。",
            ACADEMIC_OUTPUT_DISCIPLINE,
          ].join("\n"),
          prompt: [`Topic: ${topic}`, constraints ? `Constraints: ${constraints}` : ""].filter(Boolean).join("\n"),
        })
        recordLlmUsageAsync(this.deps, normalizedModel, reviewGen.usage)

        return { ok: true, provider: active.providerId, review: reviewGen.text }
      },
    })

    const academicSearch = createAcademicSearchTool({
      ...this.effectiveSearchKeys(),
    })

    const readLocalFile = createFileTool()

    return { localSourceAudit, globalLiteratureReview, academicSearch, readLocalFile }
  }

  /** 直连对话：委托 direct-chat 模块。 */
  private async runDirectChat(userInput: string): Promise<string> {
    this.throwIfAborted()
    const inf = this.inferenceCfg()
    return streamDirectChat({
      deps: this.deps,
      hooks: this.hooks,
      userInput,
      buildConversationMessages: (a, b) => this.buildConversationMessages(a, b),
      runtimeKeys: this.effectiveRuntimeKeys(),
      inference: inf,
    })
  }

  private injectLibraryContext(userInput: string): string {
    const block = this.deps.libraryContext?.trim()
    if (!block) return userInput
    return `${block}${userInput}`
  }

  async run(
    userInput: string,
    options?: { planRetryMessage?: string; targetNodeId?: string; resumeNodes?: WorkflowNode[] }
  ): Promise<{ final: string; nodes: WorkflowNode[]; sources: AcademicSearchHit[] }> {
    const effectiveInput = this.injectLibraryContext(userInput)
    console.log("🚀 Agent 收到输入:", effectiveInput)
    if (this.deps.documentIds?.length) {
      console.log("📚 文献库注入:", this.deps.documentIds.join(", "))
    }

    if (isDirectChatInput(effectiveInput)) {
      console.log("💬 走普通对话路由")
      const final = await this.runDirectChat(effectiveInput)
      return { final, nodes: [], sources: [] }
    }

    console.log("🛠️ 走任务规划路由")
    this.sessionContextMessages = []
    const targetNodeId = options?.targetNodeId ?? this.deps.targetNodeId
    const resumeSnapshots = this.deps.resumeSnapshots ?? []
    const snapshotById = snapshotMap(resumeSnapshots)

    let nodes: WorkflowNode[]
    const resumeNodes = options?.resumeNodes ?? this.deps.resumeNodes
    if (resumeNodes?.length) {
      nodes = targetNodeId ? prepareNodesForPartialResume(resumeNodes, targetNodeId) : resumeNodes
      this.hooks.onWorkflowPlanned?.(nodes)
    } else {
      nodes = await this.plan(
        effectiveInput,
        options?.planRetryMessage ? { retryMessage: options.planRetryMessage } : undefined
      )
    }

    const targetIndex = targetNodeId ? findTargetNodeIndex(nodes, targetNodeId) : -1

    const tools = this.buildTools()
    const inf = this.inferenceCfg()

    const execHooks: AgentExecutorHooks = {
      ...this.hooks,
      onWorkflowTopologyPruned: (pruned) => {
        nodes = pruned
        this.hooks.onWorkflowTopologyPruned?.(pruned)
      },
    }

    const results: Array<{ id: string; ok: boolean; summary: string; output?: unknown }> = []
    let sources: AcademicSearchHit[] = []
    let citationsMarkdown = ""

    if (targetNodeId && resumeSnapshots.length) {
      const restored = restoreExecutionStateFromSnapshots(resumeSnapshots, nodes, targetNodeId)
      results.push(...restored.results)
      sources = restored.sources
      citationsMarkdown = restored.citationsMarkdown
      this.sessionContextMessages = restored.sessionContextMessages
      this.hooks.onNodeLog?.(targetNodeId, `断点续跑：已从前序 ${targetIndex} 个节点快照汇聚 Context`)
    }

    const persistNodeDone = (
      node: WorkflowNode,
      nodeIndex: number,
      subtaskResult: { id: string; ok: boolean; summary: string; output?: unknown },
      ctx: { sessionContextDelta?: import("@/lib/agent/planner").ChatHistoryEntry[] }
    ) => {
      if (!subtaskResult.ok) return
      const record = buildNodeSnapshotRecord({
        node: { ...node, status: "done", output: subtaskResult.output },
        nodeIndex,
        nodes,
        subtaskResult,
        sources,
        citationsMarkdown,
        sessionContextDelta: ctx.sessionContextDelta,
      })
      void this.deps.onNodeSnapshotPersist?.(record)
    }

    const commitResult = (
      node: WorkflowNode,
      nodeIndex: number,
      subtaskResult: { id: string; ok: boolean; summary: string; output?: unknown },
      sessionContextDelta?: import("@/lib/agent/planner").ChatHistoryEntry[]
    ) => {
      results.push(subtaskResult)
      persistNodeDone(node, nodeIndex, subtaskResult, { sessionContextDelta })
    }

    for (let ni = 0; ni < nodes.length; ni++) {
      const n = nodes[ni]!
      this.throwIfAborted()

      if (targetNodeId && shouldSkipNodeForResume(ni, targetIndex, snapshotById.get(n.id))) {
        const snap = snapshotById.get(n.id)!
        this.hooks.onNodeLog?.(n.id, `断点续跑：跳过已完成节点 ${n.id}`)
        execHooks.onNodePatch?.(n.id, {
          status: "done",
          output: snap.outputs,
          metadata: snap.nodeSnapshot?.workflowNode?.metadata,
        })
        continue
      }

      this.hooks.onNodeLog?.(n.id, `进入节点：${n.id}`)
      execHooks.onNodePatch?.(n.id, { status: "running" })
      execHooks.onNodeLog?.(n.id, `开始执行：${n.type} · ${n.provider}`)
      const nodeStartedAt = performance.now()
      const sessionContextBefore = this.sessionContextMessages.length

      try {
        if (n.type === "peer_review" && isPeerReviewGroupStart(nodes, ni)) {
          const group = collectPeerReviewGroup(nodes, ni)
          const groupResults = await executePeerReviewGroup({
            groupNodes: group,
            userInput: effectiveInput,
            deps: this.deps,
            hooks: execHooks,
            checkpoint: this.deps.peerReviewCheckpoint ?? null,
            onCheckpoint: this.deps.onPeerReviewCheckpoint,
            allWorkflowNodes: nodes,
          })
          results.push(...groupResults)
          for (const gr of groupResults) {
            if (gr.ok) {
              const gi = nodes.findIndex((x) => x.id === gr.id)
              persistNodeDone(nodes[gi] ?? n, gi >= 0 ? gi : ni, gr, {})
            }
          }
          ni += group.length - 1
          continue
        }
        if (n.type === "peer_review") {
          continue
        }

        if (n.type === "research") {
          const payload = asRecord(n.input ?? {})
          const draftQuery =
            typeof payload["search_query"] === "string"
              ? String(payload["search_query"])
              : typeof payload["query"] === "string"
                ? String(payload["query"])
                : buildFallbackSearchQuery(effectiveInput, this.deps.getChatHistory?.() ?? [])

          const history = this.deps.getChatHistory?.() ?? []
          const search_query = await rewriteResearchSearchQuery(
            { ...this.deps, getRuntimeKeys: () => this.effectiveRuntimeKeys() },
            { userInput: effectiveInput, draftQuery, history }
          )
          const academicOnly = typeof payload["academicOnly"] === "boolean" ? Boolean(payload["academicOnly"]) : true
          const queryList = resolveResearchQueryList(payload, search_query, effectiveInput)

          console.log("🔍 research 节点执行，queries:", queryList)

          // inject per-node logger
          const keysNow = this.effectiveSearchKeys()
          const academicSearch = createAcademicSearchTool({
            ...keysNow,
            onLog: (line) => this.hooks.onNodeLog?.(n.id, line),
          })

          const exec = academicSearch.execute!
          type Exec = NonNullable<typeof academicSearch.execute>
          const toolOpts = {} as Parameters<Exec>[1]
          let out: AcademicSearchResponse | null = null
          try {
            if (queryList.length <= 1) {
              out = (await exec(
                {
                  search_query: queryList[0] ?? search_query,
                  academicOnly,
                  maxResults: DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS,
                  rerankTopK: RERANK_FINAL_TOP_K,
                },
                toolOpts
              )) as AcademicSearchResponse
            } else {
              this.hooks.onNodeLog?.(n.id, `关键词多样化：并行 ${queryList.length} 路检索…`)
              const outs = await Promise.all(
                queryList.map((q) =>
                  exec(
                    {
                      search_query: q,
                      academicOnly,
                      maxResults: DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS,
                      rerankTopK: RERANK_FINAL_TOP_K,
                    },
                    toolOpts
                  )
                )
              )
              out = mergeAcademicSearchResponses(outs as AcademicSearchResponse[], queryList.join(" | "))
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            const durationMs = Math.round(performance.now() - nodeStartedAt)
            if (isNetworkishError(e)) {
              this.hooks.onNodeLog?.(
                n.id,
                "[Diagnostic] 检测到网络/代理/CORS 类错误：将进入降级模式（基于内部知识提供初步分析，且明确无法获取实时数据）。"
              )
            }
            execHooks.onNodePatch?.(n.id, {
              status: "error",
              error: msg,
              metadata: { durationMs, fallback: true, fallbackReason: msg, fallbackKind: "academicSearch" },
            })
            results.push({
              id: n.id,
              ok: false,
              summary: `academicSearch 失败（已降级继续）：${msg}`,
              output: {
                error_info: {
                  node_id: n.id,
                  node_type: n.type,
                  provider: n.provider,
                  tool: "academicSearch",
                  message: msg,
                  durationMs,
                  is_networkish: isNetworkishError(e),
                },
              },
            })
            continue
          }

          sources = mergeAcademicSearchHits(sources, Array.isArray(out?.results) ? out.results : [])
          const synthesized = synthesizeCitationsMarkdown(sources)
          citationsMarkdown = synthesized.markdown

          const isEmpty = out.status === "empty" || out.status === "failed" || out.total === 0
          if (isEmpty) {
            const emptyMsg =
              out.message ??
              (out.status === "failed"
                ? "Tavily 返回 0 条结果。请更换检索关键词（建议使用纯英文专业术语）后重新发起检索任务。"
                : "检索工具未能找到相关文献，请提示用户更换关键词。")
            this.hooks.onNodeLog?.(n.id, `[${out.status === "failed" ? "Failed" : "Empty"}] ${emptyMsg}`)
            execHooks.onNodePatch?.(n.id, {
              status: "done",
              output: out,
              metadata: {
                kind: "search",
                total: 0,
                searchStatus: out.status === "failed" ? "failed" : "empty",
                durationMs: Math.round(performance.now() - nodeStartedAt),
                searchCompletedAt: new Date().toISOString(),
              },
            })
            results.push({
              id: n.id,
              ok: false,
              summary: `学术检索无结果（status=${out.status}）：${emptyMsg}`,
              output: out,
            })
            continue
          }

          this.hooks.onNodeLog?.(n.id, `正在分析 ${sources.length} 篇相关论文（本轮新增 ${out.total} 条）…`)
          const resultChars = (out.results ?? []).reduce(
            (sum, hit) => sum + (hit.title?.length ?? 0) + (hit.snippet?.length ?? 0),
            0
          )
          recordSearchUsageAsync(
            this.deps,
            out.provider === "serper" ? "serper" : "tavily",
            queryList.join(" | "),
            resultChars
          )
          this.pushResearchIntoSessionContext(out, citationsMarkdown, n.id)
          this.hooks.onNodeLog?.(
            n.id,
            `已将 ${sources.length} 条文献结果同步进会话 messages 上下文，准备进入推理节点。`
          )
          execHooks.onNodePatch?.(n.id, {
            status: "done",
            output: { provider: out.provider, query: out.query, academicOnly: out.academicOnly, total: out.total },
            metadata: {
              kind: "search",
              total: out.total,
              durationMs: Math.round(performance.now() - nodeStartedAt),
              searchCompletedAt: new Date().toISOString(),
            },
          })
          commitResult(
            n,
            ni,
            { id: n.id, ok: true, summary: `完成学术检索（${out.total} 条）`, output: out },
            this.sessionContextMessages.slice(sessionContextBefore)
          )
          continue
        }

        if (n.type === "read_file") {
          const inp = asRecord(n.input)
          const path = typeof inp["path"] === "string" ? String(inp["path"]) : undefined
          if (!path || !path.trim()) {
            const msg = "Error: 请提供具体的文件路径"
            const durationMs = Math.round(performance.now() - nodeStartedAt)
            execHooks.onNodePatch?.(n.id, {
              status: "error",
              error: msg,
              metadata: { durationMs, fallback: true, fallbackReason: msg, fallbackKind: "read_file" },
            })
            results.push({
              id: n.id,
              ok: false,
              summary: `read_file 参数缺失（已降级继续）：${msg}`,
              output: {
                error_info: {
                  node_id: n.id,
                  node_type: n.type,
                  provider: n.provider,
                  tool: "read_file",
                  message: msg,
                  durationMs,
                  is_networkish: false,
                },
              },
            })
            continue
          }
          if (!this.deps.sourceApiBase) {
            const msg = "SourceApiDisabled"
            const durationMs = Math.round(performance.now() - nodeStartedAt)
            execHooks.onNodePatch?.(n.id, {
              status: "error",
              error: msg,
              metadata: { durationMs, fallback: true, fallbackReason: msg, fallbackKind: "read_file" },
            })
            results.push({
              id: n.id,
              ok: false,
              summary: `read_file 不可用（已降级继续）：${msg}`,
              output: {
                error_info: {
                  node_id: n.id,
                  node_type: n.type,
                  provider: n.provider,
                  tool: "read_file",
                  message: msg,
                  durationMs,
                  is_networkish: false,
                },
              },
            })
            continue
          }

          let text = ""
          try {
            this.hooks.onNodeLog?.(n.id, `调用工具：read_file(path="${path}")`)
            text = await readSourceText(this.deps.sourceApiBase, path)
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e)
            const durationMs = Math.round(performance.now() - nodeStartedAt)
            const isLogLike = /(^|\/)logs\/.+\.log$/i.test(path.replace(/\\/g, "/")) || /\.log$/i.test(path)

            if (isReadFileNotFoundError(msg, path) && !isLogLike) {
              const fallbackText = READ_FILE_LITERATURE_FALLBACK
              this.hooks.onNodeLog?.(n.id, `[Fallback] 路径不存在或非本地文件：${path}`)
              execHooks.onNodePatch?.(n.id, {
                status: "done",
                output: { path, chars: fallbackText.length, text: fallbackText, fallback: true },
                metadata: {
                  durationMs,
                  fallback: true,
                  fallbackReason: msg,
                  fallbackKind: "read_file_not_found",
                },
              })
              commitResult(n, ni, {
                id: n.id,
                ok: true,
                summary: `read_file 未找到（已降级继续）`,
                output: { path, text: fallbackText, fallback: true, fallbackReason: msg },
              })
              continue
            }

            execHooks.onNodePatch?.(n.id, {
              status: "error",
              error: msg,
              metadata: { durationMs, fallback: true, fallbackReason: msg, fallbackKind: "read_file" },
            })
            results.push({
              id: n.id,
              ok: false,
              summary: `read_file 失败（已降级继续）：${msg}`,
              output: {
                error_info: {
                  node_id: n.id,
                  node_type: n.type,
                  provider: n.provider,
                  tool: "read_file",
                  message: msg,
                  durationMs,
                  is_networkish: isNetworkishError(e),
                },
              },
            })
            continue
          }
          this.hooks.onNodeLog?.(n.id, `读取完成：${path}（${text.length} chars）`)
          execHooks.onNodePatch?.(n.id, {
            status: "done",
            output: { path, chars: text.length },
            metadata: { durationMs: Math.round(performance.now() - nodeStartedAt) },
          })
          commitResult(n, ni, { id: n.id, ok: true, summary: `读取 ${path}（${text.length} chars）`, output: { path, text } })
          continue
        }

        if (n.type === "audit") {
          const payload = asRecord(n.input ?? {})
          this.hooks.onNodeLog?.(n.id, "调用工具：localSourceAudit(...)")
          const exec = tools.localSourceAudit.execute!
          type Exec = NonNullable<typeof tools.localSourceAudit.execute>
          const toolOpts = {} as Parameters<Exec>[1]
          const out = await exec(
            {
              path: typeof payload["path"] === "string" ? String(payload["path"]) : undefined,
              content: typeof payload["content"] === "string" ? String(payload["content"]) : undefined,
              focus: typeof payload["focus"] === "string" ? String(payload["focus"]) : effectiveInput,
            },
            toolOpts
          )
          execHooks.onNodePatch?.(n.id, { status: "done", output: out, metadata: { durationMs: Math.round(performance.now() - nodeStartedAt) } })
          commitResult(n, ni, { id: n.id, ok: true, summary: "完成本地源码审计", output: out })
          continue
        }

        // reasoning — 委托 reasoning-runner 模块
        const reasoningResult = await executeReasoningNode({
          node: n,
          deps: this.deps,
          hooks: execHooks,
          userInput: effectiveInput,
          nodes,
          results,
          sources,
          citationsMarkdown,
          tools,
          runtimeKeys: this.effectiveRuntimeKeys(),
          inference: inf,
          buildConversationMessages: (a, b) => this.buildConversationMessages(a, b),
          nodeStartedAt,
        })
        commitResult(n, ni, reasoningResult)
        continue
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const durationMs = Math.round(performance.now() - nodeStartedAt)
        logLlmCallFailure(`run: node ${n.id} (${n.type})`, e)
        if (n.type === "research") {
          // Provide actionable diagnostics for UI (node logs are rendered inline).
          if (isNetworkishError(e)) {
            this.hooks.onNodeLog?.(n.id, "[Diagnostic] 检测到网络/代理/CORS 类错误：请确认已启用同源代理（/api/proxy/*），或检查系统代理/VPN。")
          }
          if (/TavilySearchFailed:401|TavilySearchFailed:403|SerperSearchFailed:401|SerperSearchFailed:403/i.test(msg)) {
            this.hooks.onNodeLog?.(n.id, "[Diagnostic] 鉴权失败：请检查搜索 Key 是否正确、是否被撤销，且不要包含 'Bearer ' 前缀。")
          }
          if (/TavilySearchFailed:429|SerperSearchFailed:429/i.test(msg)) {
            this.hooks.onNodeLog?.(n.id, "[Diagnostic] 可能触发限流/额度不足（HTTP 429）：请检查 Tavily/Serper 额度或稍后重试。")
          }
        }
        if (n.type === "research" && msg.includes("MissingSearchApiKey")) {
          const keysNow = resolveSearchApiKeys({
            tavilyApiKey: this.deps.search?.tavilyApiKey,
            serperApiKey: this.deps.search?.serperApiKey,
          })
          this.hooks.onNodeLog?.(n.id, `[Diagnostic] Tavily Key: ${Boolean(keysNow.tavilyApiKey)} · Serper Key: ${Boolean(keysNow.serperApiKey)}`)
          if (!keysNow.tavilyApiKey && !keysNow.serperApiKey) {
            this.hooks.onNodeLog?.(
              n.id,
              "[Diagnostic] 请在 Keys 面板填入 Tavily/Serper Key，或在 .env.local 设置 TAVILY_API_KEY / NEXT_PUBLIC_TAVILY_API_KEY 后重启 dev server。"
            )
          }
        }
        execHooks.onNodePatch?.(n.id, { status: "error", error: msg, metadata: { durationMs } })
        results.push({
          id: n.id,
          ok: false,
          summary: `失败：${msg}`,
          output: {
            error_info: {
              node_id: n.id,
              node_type: n.type,
              provider: n.provider,
              message: msg,
              durationMs,
              is_networkish: isNetworkishError(e),
            },
          },
        })
      }
    }

    const lastReasoning = results
      .map((r) => r.output)
      .reverse()
      .find((o): o is { text: string } => {
        const rec = asRecord(o)
        return typeof rec["text"] === "string"
      })

    const final =
      typeof lastReasoning?.text === "string"
        ? [lastReasoning.text, citationsMarkdown ? `\n\n${citationsMarkdown}` : ""].filter(Boolean).join("")
        : [
            "我已执行完工作流，但未生成最终回答文本。",
            "",
            "子任务摘要：",
            ...results.map((r) => `- ${r.id}: ${r.ok ? "OK" : "ERR"} · ${r.summary}`),
          ].join("\n")

    return { final, nodes, sources }
  }
}

