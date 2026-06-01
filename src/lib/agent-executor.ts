import { generateText, Output, stepCountIs, streamText, tool, zodSchema, type ToolSet } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOllama } from "ai-sdk-ollama"
import { z } from "zod"
import {
  clampReasoningPrompt,
  DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS,
  formatResearchHitLines,
  formatResearchResultsForContext,
  mergeAcademicSearchHits,
  mergeAcademicSearchResponses,
  resolveResearchQueryList,
  serializeResearchOutputForReasoning,
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
import { proxyAwareFetch } from "@/lib/proxy-client"
import {
  ACADEMIC_OUTPUT_DISCIPLINE,
  applyCloudOnlyWorkflowNormalization,
  buildFallbackSearchQuery,
  buildPaperDetailSearchQuery,
  correctMisplacedReadFileNodes,
  ensureMultiSourceResearchPlan,
  isDirectChatInput,
  needsPaperDetailIntent,
  needsResearchIntent,
  parseAndValidateTaskList,
  PLAN_QUERY_OPTIMIZATION,
  PLAN_TOOL_BOUNDARY,
  PLAN_TOOL_ENFORCEMENT,
  READ_FILE_LITERATURE_FALLBACK,
  REASONING_TOOL_BOUNDARY,
  WorkflowPlanParseError,
  type ActiveProviderConfig,
  type ActiveProviderId,
  type ChatHistoryEntry,
  type WorkflowNode,
} from "@/lib/agent/planner"

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

type GenModel = Parameters<typeof generateText>[0]["model"]

/** AI SDK fetch that attaches proxy access token for same-origin /api/proxy routes. */
const PROXY_SDK_FETCH = proxyAwareFetch as typeof fetch

/** 复杂推理 / 长公式输出：放宽 HTTP 与 SDK 层超时（毫秒）。 */
const LLM_STREAM_TIMEOUT_MS = 60_000
/** 带 tools 的 reasoning 允许多步 tool loop，避免 stepCountIs(1) 在工具调用后静默截断。 */
const REASONING_TOOL_LOOP_STEPS = 12
/** 工作流推理最低输出 token 预算（复杂 LaTeX / 伪代码场景）。 */
const REASONING_MIN_OUTPUT_TOKENS = 8192

type StreamTextCallExtras = {
  /** 供应商/SDK 前向兼容：触顶后继续生成（部分 OpenAI 兼容网关支持）。 */
  experimental_continueOnLimit?: boolean
}

function mergeAbortSignals(primary?: AbortSignal | null, secondary?: AbortSignal): AbortSignal | undefined {
  const signals = [primary, secondary].filter((s): s is AbortSignal => s != null)
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals)
  return secondary ?? primary ?? undefined
}

function llmCallSettings(signal?: AbortSignal) {
  return {
    timeout: buildStreamTextTimeout(),
    ...(signal ? { abortSignal: signal } : {}),
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  throw reason instanceof Error ? reason : new DOMException("Aborted", "AbortError")
}

/** 规划阶段：HTTP 非 2xx 时上报 UI，并抛出（避免 SDK 静默吞掉）。 */
function createPlanningFetch(onHttpError: (msg: string) => void, abortSignal?: AbortSignal): typeof fetch {
  return async (input, init) => {
    const mergedSignal = mergeAbortSignals(init?.signal ?? undefined, abortSignal)
    const res = await proxyAwareFetch(input as RequestInfo, mergedSignal ? { ...init, signal: mergedSignal } : init)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      const msg = `规划失败 [状态码 ${res.status}]: ${body}`
      onHttpError(msg)
      throw new Error(msg)
    }
    return res
  }
}

export type { ChatHistoryEntry } from "@/lib/agent/planner"

export type LlmHistoryMessage = {
  role: "user" | "assistant"
  content: string
}

export type AgentExecutorDeps = {
  activeProvider: ActiveProviderConfig
  /** 从 Zustand 等状态容器读取完整对话历史（含工具/论文摘要等 assistant 回复） */
  getChatHistory?: () => ChatHistoryEntry[]
  runtimeKeys?: {
    openai?: string
    anthropic?: string
    google?: string
    deepseek?: string
    tavily?: string
    serper?: string
  }
  /**
   * 可选：从客户端状态容器获取最新明文运行时密钥。
   * 用于避免闭包/实例化时机导致的 key 过期（例如：解锁后立即发起学术检索）。
   */
  getRuntimeKeys?: () => AgentExecutorDeps["runtimeKeys"] | null | undefined
  search?: { tavilyApiKey?: string; serperApiKey?: string }
  inference?: { temperature?: number; maxTokens?: number; contextLimit?: number }
  /**
   * 在浏览器模式下，用 Next Route Handler 作为“本机代理”读取工作区文件。
   * 例如：/api/source?path=src/app/page.tsx
   */
  sourceApiBase?: string
  /** 用户点击「停止」或切换会话时传入，用于取消进行中的 LLM 请求 */
  signal?: AbortSignal
}

export type AgentExecutorHooks = {
  onWorkflowPlanned?: (nodes: WorkflowNode[]) => void
  onNodePatch?: (id: string, patch: Partial<WorkflowNode>) => void
  onNodeLog?: (id: string, line: string) => void
  /** 规划阶段 LLM HTTP 非 2xx（例如 401/429）时回调，供 UI 终端红色展示 */
  onPlanHttpError?: (message: string) => void
  /** 语义分流：直连对话开始（无拓扑规划）；用于 UI 标记 DIRECT_CHAT */
  onDirectChatStart?: () => void
  /** 直连对话流式正文累积 */
  onDirectChatStream?: (accumulated: string) => void
  /** 多节点工作流：进入下一段 streamText 前刷新前端流式指针 */
  onStreamFlush?: (ctx: { nodeId?: string; reason: "pre-reasoning-stream" | "stream-finished" | "stream-error" }) => void
  /** research 节点完成后，文献结果已写入会话上下文 */
  onResearchResultsSynced?: (ctx: {
    nodeId: string
    sources: AcademicSearchHit[]
    citationsMarkdown: string
  }) => void
}

function buildStreamTextTimeout() {
  return LLM_STREAM_TIMEOUT_MS
}

function buildReasoningOutputTokenBudget(maxTokens: number | undefined) {
  const configured = typeof maxTokens === "number" && Number.isFinite(maxTokens) ? Math.floor(maxTokens) : 1024
  return Math.max(configured, REASONING_MIN_OUTPUT_TOKENS)
}

function formatResearchResultsForSessionContext(out: AcademicSearchResponse, citationsMarkdown: string): string {
  return formatResearchResultsForContext(out, citationsMarkdown)
}

const ABSORBED_STREAM_PART_TYPES = new Set([
  "text-start",
  "text-end",
  "reasoning-start",
  "reasoning-end",
  "tool-input-start",
  "tool-input-delta",
  "tool-input-end",
  "tool-call",
  "tool-result",
  "tool-error",
  "tool-output-denied",
  "source",
  "file",
  "start",
  "finish",
  "start-step",
  "finish-step",
  "abort",
  "raw",
])

/** 健壮消费 streamText.fullStream：非文本帧只吸收不 break，确保 onFinish 与背压释放。 */
async function consumeStreamTextOutput(
  streamed: Awaited<ReturnType<typeof streamText>>,
  onAccumulated: (acc: string) => void,
  signal?: AbortSignal
): Promise<string> {
  let acc = ""
  try {
    for await (const part of streamed.fullStream) {
      assertNotAborted(signal)
      try {
        if (part.type === "text-delta" || part.type === "reasoning-delta") {
          acc += part.text
          onAccumulated(acc)
          continue
        }
        if (ABSORBED_STREAM_PART_TYPES.has(part.type)) continue
        if (part.type === "error") {
          console.warn("跳过未知流片段:", part)
          continue
        }
        console.warn("跳过未知流片段:", part)
      } catch (chunkErr) {
        console.warn("跳过未知流片段:", part, chunkErr)
      }
    }
  } catch (e) {
    logLlmCallFailure("consumeStreamTextOutput: fullStream failed", e)
    throw e
  }

  if (!acc.trim()) {
    try {
      const fallback = await Promise.resolve(streamed.text)
      if (typeof fallback === "string" && fallback.trim()) {
        acc = fallback
        onAccumulated(acc)
      }
    } catch {
      // ignore — caller handles empty
    }
  }

  try {
    await streamed.consumeStream()
  } catch {
    // stream already consumed
  }

  return acc
}


async function readSourceText(sourceApiBase: string, path: string) {
  const qp = new URLSearchParams({ path })
  const url = `${sourceApiBase.replace(/\/$/, "")}/api/source?${qp.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    const isLogLike = /(^|\/)logs\/.+\.log$/i.test(path.replace(/\\/g, "/")) || /\.log$/i.test(path)
    const notFoundLike =
      res.status === 404 && (txt.includes('"error":"NotFound"') || txt.toLowerCase().includes("enoent") || !txt)
    if (isLogLike && notFoundLike) {
      return "日志文件尚未生成，请参考内存中的原始错误对象。"
    }
    throw new Error(`ReadSourceFailed:${res.status}:${txt || res.statusText}`)
  }
  return await res.text()
}

function isNetworkishError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.toLowerCase()
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("timeout") ||
    m.includes("ecconn") ||
    m.includes("socket") ||
    m.includes("503") ||
    m.includes("429")
  )
}

function isReadFileNotFoundError(msg: string, path: string): boolean {
  const m = msg.toLowerCase()
  if (m.includes("notfound") || m.includes(":404:") || m.includes("readsourcefailed:404")) return true
  if (/404/.test(msg) && (m.includes("enoent") || m.includes("not found"))) return true
  const isLogLike = /(^|\/)logs\/.+\.log$/i.test(path.replace(/\\/g, "/")) || /\.log$/i.test(path)
  return isLogLike && m.includes("notfound")
}

/** 终端诊断：AI SDK 的 APICallError 等会带 statusCode / responseBody */
function logLlmCallFailure(context: string, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e)
  let httpStatus: number | string = "—"
  let responseBody: string | undefined
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>
    if (typeof o.statusCode === "number") httpStatus = o.statusCode
    const rb = o.responseBody
    if (typeof rb === "string" && rb.length) responseBody = rb.length > 1200 ? `${rb.slice(0, 1200)}…` : rb
  }
  console.error(`[AgentExecutor] ${context}`, { httpStatus, message: msg, responseBody })
}

function unwrapErrorChain(error: unknown): unknown[] {
  const chain: unknown[] = []
  let cur: unknown = error
  const seen = new Set<unknown>()
  while (cur != null && !seen.has(cur)) {
    seen.add(cur)
    chain.push(cur)
    if (cur instanceof Error && cur.cause != null) cur = cur.cause
    else break
  }
  return chain
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)"
      return `${path}: ${issue.message}`
    })
    .join("; ")
}

/** 规划器崩溃：尽可能提取 schema / validation / HTTP 等细节 */
function formatPlanCrashDetail(error: unknown): Record<string, unknown> {
  const chain = unwrapErrorChain(error)
  const out: Record<string, unknown> = { chainLength: chain.length }

  for (let i = 0; i < chain.length; i++) {
    const item = chain[i]
    const prefix = `link${i}`
    if (item instanceof z.ZodError) {
      out[`${prefix}_kind`] = "ZodValidationError"
      out[`${prefix}_issues`] = item.issues
      out[`${prefix}_message`] = formatZodIssues(item)
      continue
    }
    if (item instanceof Error) {
      out[`${prefix}_name`] = item.name
      out[`${prefix}_message`] = item.message
      if (item instanceof WorkflowPlanParseError) {
        out[`${prefix}_causeDetail`] = item.causeDetail
        out[`${prefix}_rawContentPreview`] = item.rawContent.slice(0, 800)
      }
      const rec = item as Error & Record<string, unknown>
      if (typeof rec.statusCode === "number") out[`${prefix}_statusCode`] = rec.statusCode
      if (typeof rec.responseBody === "string") {
        out[`${prefix}_responseBody`] = rec.responseBody.slice(0, 1200)
      }
      if (typeof rec.text === "string") out[`${prefix}_text`] = rec.text.slice(0, 800)
      if (typeof rec.value === "string") out[`${prefix}_value`] = rec.value.slice(0, 800)
      if (Array.isArray(rec.issues)) out[`${prefix}_issues`] = rec.issues
      if (Array.isArray(rec.errors)) out[`${prefix}_errors`] = rec.errors
      if (rec.data != null) {
        try {
          out[`${prefix}_data`] = typeof rec.data === "string" ? rec.data.slice(0, 800) : rec.data
        } catch {
          out[`${prefix}_data`] = "[unserializable]"
        }
      }
      continue
    }
    if (item && typeof item === "object") {
      const rec = item as Record<string, unknown>
      out[`${prefix}_object`] = {
        name: rec.name,
        message: rec.message,
        code: rec.code,
        statusCode: rec.statusCode,
        issues: rec.issues,
        errors: rec.errors,
      }
      continue
    }
    out[`${prefix}_raw`] = String(item)
  }

  return out
}

function formatPlanCrashMessage(error: unknown): string {
  if (error instanceof WorkflowPlanParseError) {
    const base = error.causeDetail ?? error.message
    const preview = error.rawContent.trim().slice(0, 240)
    return preview ? `${base} | rawPreview: ${preview}` : base
  }
  if (error instanceof z.ZodError) {
    return `SchemaValidationError: ${formatZodIssues(error)}`
  }
  if (error instanceof Error) {
    const name = error.name || "Error"
    if (/validation|schema|json|type/i.test(name)) {
      const rec = error as Error & { issues?: unknown; errors?: unknown }
      const issueHint =
        Array.isArray(rec.issues) && rec.issues.length
          ? ` | issues: ${JSON.stringify(rec.issues).slice(0, 600)}`
          : Array.isArray(rec.errors) && rec.errors.length
            ? ` | errors: ${JSON.stringify(rec.errors).slice(0, 600)}`
            : ""
      return `${name}: ${error.message}${issueHint}`
    }
    return error.message || name
  }
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function logPlanCrashReason(error: unknown, context: string) {
  console.error("🔥🔥🔥 PLAN_CRASH_REASON:", error)
  console.error(`🔥 PLAN_CRASH_CONTEXT: ${context}`)
  console.error("🔥 PLAN_CRASH_DETAIL:", formatPlanCrashDetail(error))
}

async function generatePlanTextWithStructuredFallback(input: {
  context: string
  model: GenModel
  systemStructured: string
  systemPlain: string
  messages: LlmHistoryMessage[]
  temperature: number
  signal?: AbortSignal
}): Promise<{ gen: Awaited<ReturnType<typeof generateText>>; usesStructuredJson: boolean }> {
  const llmOpts = llmCallSettings(input.signal)
  try {
    const gen = await generateText({
      model: input.model,
      system: input.systemStructured,
      messages: input.messages,
      temperature: input.temperature,
      ...llmOpts,
      output: Output.json({
        name: "scholarkernel_workflow_plan",
        description: "Task DAG as JSON object with tasks[]",
      }),
    })
    return { gen, usesStructuredJson: true }
  } catch (structuredErr) {
    logPlanCrashReason(structuredErr, `${input.context}: structured JSON generateText failed — trying plain-text fallback`)
    logLlmCallFailure(`${input.context}: structured JSON generateText failed`, structuredErr)
    try {
      const gen = await generateText({
        model: input.model,
        system: input.systemPlain,
        messages: input.messages,
        temperature: input.temperature,
        ...llmOpts,
      })
      return { gen, usesStructuredJson: false }
    } catch (fallbackErr) {
      logPlanCrashReason(fallbackErr, `${input.context}: plain-text fallback failed`)
      logLlmCallFailure(`${input.context}: plain-text fallback failed`, fallbackErr)
      throw new Error(
        `structured=${formatPlanCrashMessage(structuredErr)} | fallback=${formatPlanCrashMessage(fallbackErr)}`
      )
    }
  }
}

function keyForActiveProvider(runtimeKeys: AgentExecutorDeps["runtimeKeys"] | undefined, providerId: ActiveProviderId) {
  switch (providerId) {
    case "openai":
      return runtimeKeys?.openai
    case "deepseek_openai_compat":
      return runtimeKeys?.deepseek
    case "anthropic":
      return runtimeKeys?.anthropic
    case "google":
      return runtimeKeys?.google
    default:
      return undefined
  }
}

function normalizeModelId(providerId: ActiveProviderId, model: string) {
  if (providerId === "deepseek_openai_compat") return "deepseek-chat"
  const m = (model ?? "").trim()
  return m
}

function normalizeOpenAICompatBaseUrl(baseUrl: string | undefined, providerId: "openai" | "deepseek_openai_compat") {
  const b = (baseUrl ?? "").trim().replace(/\/$/, "")
  const fallback = providerId === "openai" ? "https://api.openai.com" : "https://api.deepseek.com"
  const root = b || fallback
  return root.endsWith("/v1") ? root : `${root}/v1`
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function safeEnv(name: string): string {
  try {
    const v = (process.env as Record<string, string | undefined> | undefined)?.[name]
    return typeof v === "string" ? v.trim() : ""
  } catch {
    return ""
  }
}

type RuntimeKeys = NonNullable<AgentExecutorDeps["runtimeKeys"]>

function runtimeKeysFromEnv(): RuntimeKeys {
  return {
    openai: safeEnv("OPENAI_API_KEY"),
    anthropic: safeEnv("ANTHROPIC_API_KEY"),
    google: safeEnv("GOOGLE_API_KEY") || safeEnv("GEMINI_API_KEY"),
    deepseek: safeEnv("DEEPSEEK_API_KEY"),
    tavily: safeEnv("TAVILY_API_KEY"),
    serper: safeEnv("SERPER_API_KEY"),
  }
}

function proxyBaseForProvider(providerId: ActiveProviderId) {
  if (!isBrowser()) return null
  if (providerId === "openai") return "/api/proxy/openai"
  if (providerId === "deepseek_openai_compat") return "/api/proxy/deepseek"
  if (providerId === "anthropic") return "/api/proxy/anthropic"
  if (providerId === "google") return "/api/proxy/google"
  return null
}

function normalizeOpenAICompatBaseUrlWithProxy(baseUrl: string | undefined, providerId: "openai" | "deepseek_openai_compat") {
  const proxy = proxyBaseForProvider(providerId)
  if (proxy) {
    // 强制同源：DeepSeek 仅走 Next rewrites，忽略用户配置的直连域名（OpenAI SDK 需 /v1 后缀）
    if (providerId === "deepseek_openai_compat") return "/api/proxy/deepseek/v1"
    return proxy.endsWith("/v1") ? proxy : `${proxy}/v1`
  }
  return normalizeOpenAICompatBaseUrl(baseUrl, providerId)
}

function providerSelfIntro(active: ActiveProviderConfig) {
  const p = active.providerId
  const m = normalizeModelId(p, active.model)
  if (p === "deepseek_openai_compat") {
    return [
      "你是 ScholarKernel-Agent。",
      `你的底层模型当前由 DeepSeek 提供动力（${m}）。`,
      "当用户问“你是谁/你的模型是什么”时，你必须回答：“基于 DeepSeek-V3 的 ScholarKernel 核心”。",
    ].join("")
  }
  return [
    "你是 ScholarKernel-Agent。",
    `你的底层模型当前由 ${p}（${m}）提供动力。`,
    "回答“你是谁/你的模型是什么”时，必须以当前运行配置为准，禁止使用固定模板或虚构供应商信息。",
  ].join("")
}

function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

function clampTextByChars(text: string, limit: number | undefined) {
  const lim = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (!lim) return text
  if (text.length <= lim) return text
  return text.slice(0, lim) + "\n\n[...truncated by contextLimit...]"
}

/** 将 chat store 消息转为 LLM 历史，并把文献摘要织入 assistant 上下文链条。 */
export function buildChatHistoryForExecutor(
  messages: Array<{
    role: "user" | "assistant" | "system"
    content: string
    sources?: Array<{ title: string; url: string; snippet?: string; publishedAt?: string; source_id?: string }>
  }>
): ChatHistoryEntry[] {
  const out: ChatHistoryEntry[] = []

  for (const m of messages) {
    if (m.role === "system") continue

    let content = (m.content ?? "").trim()
    if (m.role === "assistant" && m.sources?.length) {
      const refLines = formatResearchHitLines(
        m.sources.map((s, i) => ({
          source_id: s.source_id?.trim() ? s.source_id.trim() : String(i + 1),
          title: s.title,
          url: s.url,
          snippet: s.snippet,
          publishedAt: s.publishedAt,
        }))
      )
      content = [content, "", "---", "检索工具返回的文献摘要 (tool result):", ...refLines].filter(Boolean).join("\n")
    }

    if (!content.trim()) continue
    out.push({ role: m.role, content })
  }

  return out
}

/** 从 store 消息中提取可发给 LLM 的历史轮次（跳过空占位与当前轮重复项）。 */
export function extractLlmHistory(
  messages: ChatHistoryEntry[] | undefined,
  currentUserInput: string
): LlmHistoryMessage[] {
  if (!messages?.length) return []
  const current = currentUserInput.trim()
  const out: LlmHistoryMessage[] = []

  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue
    const content = (m.content ?? "").trim()
    if (!content) continue
    out.push({ role: m.role, content: m.content })
  }

  // 移除末尾空 assistant 占位，以及重复的当前 user 输入（由 buildLlmMessages 追加）
  while (out.length > 0) {
    const last = out[out.length - 1]!
    if (last.role === "assistant" && !last.content.trim()) {
      out.pop()
      continue
    }
    if (last.role === "user" && last.content.trim() === current) {
      out.pop()
    }
    break
  }

  return out
}

function trimHistoryToContextLimit(
  history: LlmHistoryMessage[],
  currentPrompt: string,
  contextLimit: number | undefined
): LlmHistoryMessage[] {
  const lim =
    typeof contextLimit === "number" && Number.isFinite(contextLimit) ? Math.max(0, Math.floor(contextLimit)) : 0
  if (!lim || history.length === 0) return history

  const budget = Math.max(0, lim - currentPrompt.length - 800)
  if (budget <= 0) return []

  let total = history.reduce((acc, m) => acc + m.content.length, 0)
  const trimmed = [...history]
  while (total > budget && trimmed.length > 0) {
    const removed = trimmed.shift()!
    total -= removed.content.length
  }
  return trimmed
}

function buildLlmMessages(history: LlmHistoryMessage[], currentUserContent: string): LlmHistoryMessage[] {
  return [...history, { role: "user", content: currentUserContent }]
}

function needsQueryRewrite(userInput: string, draftQuery: string): boolean {
  const u = userInput.trim()
  const q = draftQuery.trim()
  if (/[\u4e00-\u9fff]/.test(q)) return true
  if (/^(再|还|帮).{0,10}(找|搜|查)|^(找|搜|查).{0,8}(一篇|一下|文献|论文)/i.test(u)) return true
  if (q.length < 8) return true
  return false
}

/** 指代消解 + 中英学术转换：口语中文 → Tavily 友好的纯英文学术关键词 */
async function rewriteResearchSearchQuery(
  deps: AgentExecutorDeps,
  opts: { userInput: string; draftQuery: string; history: ChatHistoryEntry[] }
): Promise<string> {
  const draft = opts.draftQuery.trim()
  if (!needsQueryRewrite(opts.userInput, draft) && /^[\x20-\x7E]+$/.test(draft) && draft.length >= 12) {
    return draft
  }

  const rk = deps.getRuntimeKeys?.() ?? deps.runtimeKeys
  const dsKey = rk?.deepseek?.trim()
  const active = deps.activeProvider

  if (dsKey) {
    try {
      const openai = createOpenAI({
        apiKey: dsKey,
        fetch: PROXY_SDK_FETCH,
        baseURL: normalizeOpenAICompatBaseUrlWithProxy(
          active.providerId === "deepseek_openai_compat" ? active.baseUrl : undefined,
          "deepseek_openai_compat"
        ),
      })
      const model = openai.chat("deepseek-chat")
      const historySlice = trimHistoryToContextLimit(
        extractLlmHistory(opts.history, opts.userInput),
        opts.userInput,
        deps.inference?.contextLimit
      ).slice(-8)

      const { text } = await generateText({
        model,
        ...llmCallSettings(deps.signal),
        temperature: 0.1,
        system: [
          "你是学术检索 query 改写器（指代消解 + 中英转换）。",
          "结合对话历史，将用户口语中文或模糊短句改写为适合 Tavily/arXiv 的纯英文学术关键词。",
          "规则：",
          "- 只输出一行 query 字符串，不要引号、不要 Markdown、不要解释",
          "- 必须英文，含领域术语 + research papers / arxiv / survey 等检索提示",
          "- 示例：「再找一篇视觉的」→ latest computer vision deep learning research papers arxiv 2024",
        ].join("\n"),
        messages: [
          ...historySlice,
          {
            role: "user",
            content: [
              `用户当前输入: ${opts.userInput}`,
              `规划阶段 draft query: ${draft || "(empty)"}`,
              "请输出优化后的英文学术 search_query:",
            ].join("\n"),
          },
        ],
      })

      const rewritten = text
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/\s+/g, " ")
        .trim()
      if (rewritten.length >= 8 && !/[\u4e00-\u9fff]/.test(rewritten)) {
        console.log("🔁 Query rewritten:", { from: draft, to: rewritten })
        return rewritten
      }
    } catch (e) {
      console.warn("⚠️ LLM query rewrite failed, using rule-based fallback:", e)
    }
  }

  return buildFallbackSearchQuery(opts.userInput, opts.history)
}

/** 将子任务 output 序列化为 reasoning 可读摘要（含 empty / error 状态，避免静默丢失）。 */
function serializeSubtaskForReasoning(r: { id: string; ok: boolean; summary: string; output?: unknown }) {
  const rec = asRecord(r.output)
  const base = { id: r.id, ok: r.ok, summary: r.summary }

  if (
    rec["status"] === "empty" ||
    rec["status"] === "failed" ||
    (rec["provider"] != null && Number(rec["total"]) === 0)
  ) {
    return {
      ...base,
      search_status: rec["status"] === "failed" ? ("failed" as const) : ("empty" as const),
      query: rec["query"],
      message:
        rec["message"] ??
        (rec["status"] === "failed"
          ? "Tavily 返回 0 条结果。请更换检索关键词（建议使用纯英文专业术语）后重新发起检索任务。"
          : "检索工具未能找到相关文献，请提示用户更换关键词。"),
    }
  }

  if (typeof rec["provider"] === "string") {
    if (Array.isArray(rec["results"]) && rec["results"].length > 0) {
      return { ...base, ...serializeResearchOutputForReasoning(rec) }
    }
    return {
      ...base,
      search_status: "ok" as const,
      query: rec["query"],
      total: rec["total"],
      provider: rec["provider"],
    }
  }

  if (!r.ok) {
    return {
      ...base,
      error_info: rec["error_info"] ?? rec["message"] ?? r.summary,
    }
  }

  if (typeof rec["text"] === "string" && rec["text"].trim()) {
    const text = String(rec["text"])
    if (rec["fallback"]) {
      return {
        ...base,
        read_file_fallback: true,
        system_notice: text,
        text_preview: text.slice(0, 500),
      }
    }
    return { ...base, text_preview: text.slice(0, 500) }
  }

  return base
}

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
    const content = formatResearchResultsForSessionContext(out, citationsMarkdown)
    this.sessionContextMessages.push({ role: "assistant", content })
    this.hooks.onResearchResultsSynced?.({
      nodeId,
      sources: Array.isArray(out.results) ? out.results : [],
      citationsMarkdown,
    })
  }

  /** 工作流 reasoning 等云端推理：active 为 Ollama 时改用 DeepSeek Key（与规划一致）。 */
  private buildGenModelForCloudInference(node: WorkflowNode): GenModel {
    const rk = this.effectiveRuntimeKeys()
    const active = this.deps.activeProvider
    const meta = node.metadata
    const fromMeta =
      meta && typeof meta["inferenceModel"] === "string" ? String(meta["inferenceModel"]).trim() : ""
    const modelId =
      fromMeta ||
      (active.providerId !== "ollama" ? normalizeModelId(active.providerId, active.model) : "deepseek-chat")

    if (active.providerId !== "ollama") {
      const apiKey = keyForActiveProvider(rk, active.providerId)?.trim()
      if (!apiKey) throw new Error("MissingApiKey")
      if (active.providerId === "anthropic") {
        return createAnthropic({ apiKey, baseURL: active.baseUrl, fetch: PROXY_SDK_FETCH })(modelId)
      }
      if (active.providerId === "google") {
        return createGoogleGenerativeAI({ apiKey, baseURL: active.baseUrl, fetch: PROXY_SDK_FETCH })(modelId)
      }
      if (active.providerId === "openai" || active.providerId === "deepseek_openai_compat") {
        return createOpenAI({
          apiKey,
          fetch: PROXY_SDK_FETCH,
          baseURL: normalizeOpenAICompatBaseUrlWithProxy(active.baseUrl, active.providerId),
        }).chat(modelId)
      }
      throw new Error("UnsupportedProvider")
    }

    const dsKey = rk?.deepseek?.trim()
    if (!dsKey) throw new Error("MissingApiKey")
    return createOpenAI({
      apiKey: dsKey,
      fetch: PROXY_SDK_FETCH,
      baseURL: normalizeOpenAICompatBaseUrlWithProxy(undefined, "deepseek_openai_compat"),
    }).chat(modelId)
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
      "每个子任务必须符合协议：{ id, type: read_file|reasoning|audit|research, provider: cloud, status }。",
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
        const { text } = await generateText({
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
        return { ok: true, path, focus, report: text }
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

        const { text } = await generateText({
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

        return { ok: true, provider: active.providerId, review: text }
      },
    })

    const academicSearch = createAcademicSearchTool({
      ...this.effectiveSearchKeys(),
    })

    const readLocalFile = createFileTool()

    return { localSourceAudit, globalLiteratureReview, academicSearch, readLocalFile }
  }

  /** 直连对话：无工具、无拓扑；流式正文经 onDirectChatStream 回传。 */
  private async streamDirectChat(userInput: string): Promise<string> {
    this.throwIfAborted()
    const active = this.deps.activeProvider
    const inf = this.inferenceCfg()
    const rk = this.effectiveRuntimeKeys()
    const apiKey = (keyForActiveProvider(rk, active.providerId) ?? "").trim()
    const normalizedModel = normalizeModelId(active.providerId, active.model)

    let model: GenModel
    if (active.providerId === "ollama") {
      model = createOllama({ baseURL: active.baseUrl })(active.model)
    } else {
      if (!apiKey) throw new Error("MissingApiKey")
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
    }

    const sys = [
      providerSelfIntro(active),
      "",
      "当前为 DIRECT_CHAT 模式：无子任务拓扑、不要输出 JSON 任务数组或 ```json 围栏。",
      "messages 含完整对话历史；请结合上一轮 assistant 内容回答（如用户要求总结上一篇论文）。",
      "用自然中文简洁回答用户即可。",
      "",
      ACADEMIC_OUTPUT_DISCIPLINE,
    ].join("\n")

    this.hooks.onDirectChatStart?.()

    const chatMessages = this.buildConversationMessages(userInput, userInput.trim())

    let streamed: Awaited<ReturnType<typeof streamText>>
    try {
      streamed = await streamText({
        model,
        temperature: Math.min(0.72, (inf.temperature ?? 0.45) + 0.12),
        system: sys,
        messages: chatMessages,
        ...this.llmSettings(),
        maxOutputTokens: buildReasoningOutputTokenBudget(inf.maxTokens),
        ...( { experimental_continueOnLimit: true } satisfies StreamTextCallExtras ),
        onFinish: () => {
          this.hooks.onStreamFlush?.({ reason: "stream-finished" })
        },
        onError: ({ error }) => {
          logLlmCallFailure("streamDirectChat: onError", error)
        },
      })
    } catch (e) {
      logLlmCallFailure("streamDirectChat: streamText failed", e)
      throw e
    }

    const acc = await consumeStreamTextOutput(streamed, (text) => {
      this.hooks.onDirectChatStream?.(text)
    }, this.deps.signal)

    return acc
  }

  async run(
    userInput: string,
    options?: { planRetryMessage?: string }
  ): Promise<{ final: string; nodes: WorkflowNode[]; sources: AcademicSearchHit[] }> {
    console.log("🚀 Agent 收到输入:", userInput)

    if (isDirectChatInput(userInput)) {
      console.log("💬 走普通对话路由")
      const final = await this.streamDirectChat(userInput)
      return { final, nodes: [], sources: [] }
    }

    console.log("🛠️ 走任务规划路由")
    this.sessionContextMessages = []
    const nodes = await this.plan(userInput, options?.planRetryMessage ? { retryMessage: options.planRetryMessage } : undefined)
    const tools = this.buildTools()
    const inf = this.inferenceCfg()

    const results: Array<{ id: string; ok: boolean; summary: string; output?: unknown }> = []
    let sources: AcademicSearchHit[] = []
    let citationsMarkdown = ""

    for (const n of nodes) {
      this.throwIfAborted()
      this.hooks.onNodeLog?.(n.id, `进入节点：${n.id}`)
      this.hooks.onNodePatch?.(n.id, { status: "running" })
      this.hooks.onNodeLog?.(n.id, `开始执行：${n.type} · ${n.provider}`)
      const nodeStartedAt = performance.now()

      try {
        if (n.type === "research") {
          const payload = asRecord(n.input ?? {})
          const draftQuery =
            typeof payload["search_query"] === "string"
              ? String(payload["search_query"])
              : typeof payload["query"] === "string"
                ? String(payload["query"])
                : buildFallbackSearchQuery(userInput, this.deps.getChatHistory?.() ?? [])

          const history = this.deps.getChatHistory?.() ?? []
          const search_query = await rewriteResearchSearchQuery(
            { ...this.deps, getRuntimeKeys: () => this.effectiveRuntimeKeys() },
            { userInput, draftQuery, history }
          )
          const academicOnly = typeof payload["academicOnly"] === "boolean" ? Boolean(payload["academicOnly"]) : true
          const queryList = resolveResearchQueryList(payload, search_query, userInput)

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
                },
                toolOpts
              )) as AcademicSearchResponse
            } else {
              this.hooks.onNodeLog?.(n.id, `关键词多样化：并行 ${queryList.length} 路检索…`)
              const outs = await Promise.all(
                queryList.map((q) =>
                  exec(
                    { search_query: q, academicOnly, maxResults: DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS },
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
            this.hooks.onNodePatch?.(n.id, {
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
            this.hooks.onNodePatch?.(n.id, {
              status: "done",
              output: out,
              metadata: {
                kind: "search",
                total: 0,
                searchStatus: out.status === "failed" ? "failed" : "empty",
                durationMs: Math.round(performance.now() - nodeStartedAt),
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
          this.pushResearchIntoSessionContext(out, citationsMarkdown, n.id)
          this.hooks.onNodeLog?.(
            n.id,
            `已将 ${sources.length} 条文献结果同步进会话 messages 上下文，准备进入推理节点。`
          )
          this.hooks.onNodePatch?.(n.id, {
            status: "done",
            output: { provider: out.provider, query: out.query, academicOnly: out.academicOnly, total: out.total },
            metadata: { kind: "search", total: out.total, durationMs: Math.round(performance.now() - nodeStartedAt) },
          })
          results.push({ id: n.id, ok: true, summary: `完成学术检索（${out.total} 条）`, output: out })
          continue
        }

        if (n.type === "read_file") {
          const inp = asRecord(n.input)
          const path = typeof inp["path"] === "string" ? String(inp["path"]) : undefined
          if (!path || !path.trim()) {
            const msg = "Error: 请提供具体的文件路径"
            const durationMs = Math.round(performance.now() - nodeStartedAt)
            this.hooks.onNodePatch?.(n.id, {
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
            this.hooks.onNodePatch?.(n.id, {
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
              this.hooks.onNodePatch?.(n.id, {
                status: "done",
                output: { path, chars: fallbackText.length, text: fallbackText, fallback: true },
                metadata: {
                  durationMs,
                  fallback: true,
                  fallbackReason: msg,
                  fallbackKind: "read_file_not_found",
                },
              })
              results.push({
                id: n.id,
                ok: true,
                summary: `read_file 未找到（已降级继续）`,
                output: { path, text: fallbackText, fallback: true, fallbackReason: msg },
              })
              continue
            }

            this.hooks.onNodePatch?.(n.id, {
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
          this.hooks.onNodePatch?.(n.id, {
            status: "done",
            output: { path, chars: text.length },
            metadata: { durationMs: Math.round(performance.now() - nodeStartedAt) },
          })
          results.push({ id: n.id, ok: true, summary: `读取 ${path}（${text.length} chars）`, output: { path, text } })
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
              focus: typeof payload["focus"] === "string" ? String(payload["focus"]) : userInput,
            },
            toolOpts
          )
          this.hooks.onNodePatch?.(n.id, { status: "done", output: out, metadata: { durationMs: Math.round(performance.now() - nodeStartedAt) } })
          results.push({ id: n.id, ok: true, summary: "完成本地源码审计", output: out })
          continue
        }

        // reasoning
        const active = this.deps.activeProvider
        const normalizedModel = normalizeModelId(active.providerId, active.model)

        // Guardrail: no empty survey when all evidence collection failed/empty.
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
            return rec["status"] === "empty" || rec["status"] === "failed" || r.summary.includes("status=empty") || r.summary.includes("status=failed")
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

            this.hooks.onNodePatch?.(n.id, {
              status: "done",
              output: { text },
              metadata: {
                durationMs: Math.round(performance.now() - nodeStartedAt),
                guardrail: "no-evidence",
                diagnosticReasoning: true,
              },
            })
            results.push({ id: n.id, ok: false, summary: "无有效采集结果，拒绝空综述", output: { text } })
            continue
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
        const model = this.buildGenModelForCloudInference(inferNode)

        this.hooks.onNodeLog?.(n.id, "开始流式推理：streamText(...)")
        this.hooks.onStreamFlush?.({ nodeId: n.id, reason: "pre-reasoning-stream" })
        let acc = ""
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
            citationsMarkdown
              ? ["", "已检索到的参考文献（完整保留，禁止省略 URL）：", citationsMarkdown].join("\n")
              : "",
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

        const reasoningMessages = this.buildConversationMessages(userInput, prompt)

        const streamed = await streamText({
          model,
          temperature: inf.temperature ?? 0.35,
          tools,
          system: sys,
          messages: reasoningMessages,
          ...this.llmSettings(),
          maxOutputTokens: buildReasoningOutputTokenBudget(inf.maxTokens),
          stopWhen: stepCountIs(REASONING_TOOL_LOOP_STEPS),
          ...( { experimental_continueOnLimit: true } satisfies StreamTextCallExtras ),
          onFinish: () => {
            this.hooks.onStreamFlush?.({ nodeId: n.id, reason: "stream-finished" })
          },
          onError: ({ error }) => {
            logLlmCallFailure(`run: node ${n.id} stream onError`, error)
            this.hooks.onStreamFlush?.({ nodeId: n.id, reason: "stream-error" })
          },
        })

        acc = await consumeStreamTextOutput(streamed, (text) => {
          if (!sawFirst && text.length > 0) {
            sawFirst = true
            this.hooks.onNodeLog?.(n.id, "首个 token 已到达 (TTFT)")
          }
          acc = text
          this.hooks.onNodePatch?.(n.id, { output: { text: acc } })
        }, this.deps.signal)

        this.hooks.onNodePatch?.(n.id, {
          status: "done",
          output: { text: acc },
          metadata: { durationMs: Math.round(performance.now() - nodeStartedAt) },
        })
        results.push({ id: n.id, ok: true, summary: "推理整合完成", output: { text: acc } })
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
        this.hooks.onNodePatch?.(n.id, { status: "error", error: msg, metadata: { durationMs } })
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

