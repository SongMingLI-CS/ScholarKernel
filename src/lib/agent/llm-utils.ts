import { generateText, Output, streamText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOllama } from "ai-sdk-ollama"
import { z } from "zod"
import { proxyAwareFetch } from "@/lib/proxy-client"
import {
  formatResearchHitLines,
  serializeResearchOutputForReasoning,
} from "@/lib/tools/academic-search-strategy"
import { formatResearchResultsForContext } from "@/lib/tools/academic-search-strategy"
import type { AcademicSearchResponse } from "@/lib/tools/search-tool"
import {
  buildFallbackSearchQuery,
  WorkflowPlanParseError,
  type ActiveProviderConfig,
  type ActiveProviderId,
  type ChatHistoryEntry,
} from "@/lib/agent/planner"
import type { AgentExecutorDeps, LlmHistoryMessage } from "@/lib/agent/executor-types"

export type GenModel = Parameters<typeof generateText>[0]["model"]

export const PROXY_SDK_FETCH = proxyAwareFetch as typeof fetch

export const LLM_STREAM_TIMEOUT_MS = 60_000
export const REASONING_TOOL_LOOP_STEPS = 12
export const REASONING_MIN_OUTPUT_TOKENS = 8192

export type StreamTextCallExtras = {
  experimental_continueOnLimit?: boolean
}

export function mergeAbortSignals(primary?: AbortSignal | null, secondary?: AbortSignal): AbortSignal | undefined {
  const signals = [primary, secondary].filter((s): s is AbortSignal => s != null)
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals)
  return secondary ?? primary ?? undefined
}

export function llmCallSettings(signal?: AbortSignal) {
  return {
    timeout: LLM_STREAM_TIMEOUT_MS,
    ...(signal ? { abortSignal: signal } : {}),
  }
}

export function assertNotAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return
  const reason = signal.reason
  throw reason instanceof Error ? reason : new DOMException("Aborted", "AbortError")
}

export function createPlanningFetch(onHttpError: (msg: string) => void, abortSignal?: AbortSignal): typeof fetch {
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

export function buildReasoningOutputTokenBudget(maxTokens: number | undefined) {
  const configured = typeof maxTokens === "number" && Number.isFinite(maxTokens) ? Math.floor(maxTokens) : 1024
  return Math.max(configured, REASONING_MIN_OUTPUT_TOKENS)
}

export function formatResearchResultsForSessionContext(out: AcademicSearchResponse, citationsMarkdown: string): string {
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

export async function consumeStreamTextOutput(
  streamed: Awaited<ReturnType<typeof streamText>>,
  onAccumulated: (acc: string) => void,
  signal?: AbortSignal,
  options?: {
    onStreamComplete?: (ctx: { ttftMs: number | null }) => void
  }
): Promise<string> {
  let acc = ""
  let ttftMs: number | null = null
  const streamStartedAt = performance.now()
  try {
    for await (const part of streamed.fullStream) {
      assertNotAborted(signal)
      try {
        if (part.type === "text-delta" || part.type === "reasoning-delta") {
          if (ttftMs == null) ttftMs = Math.round(performance.now() - streamStartedAt)
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
      // ignore
    }
  }

  try {
    await streamed.consumeStream()
  } catch {
    // stream already consumed
  }

  options?.onStreamComplete?.({ ttftMs })

  return acc
}

export async function readSourceText(sourceApiBase: string, path: string) {
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

export function isNetworkishError(e: unknown) {
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

export function isReadFileNotFoundError(msg: string, path: string): boolean {
  const m = msg.toLowerCase()
  if (m.includes("notfound") || m.includes(":404:") || m.includes("readsourcefailed:404")) return true
  if (/404/.test(msg) && (m.includes("enoent") || m.includes("not found"))) return true
  const isLogLike = /(^|\/)logs\/.+\.log$/i.test(path.replace(/\\/g, "/")) || /\.log$/i.test(path)
  return isLogLike && m.includes("notfound")
}

export function logLlmCallFailure(context: string, e: unknown) {
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

export function formatPlanCrashDetail(error: unknown): Record<string, unknown> {
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
      continue
    }
    out[`${prefix}_raw`] = String(item)
  }

  return out
}

export function formatPlanCrashMessage(error: unknown): string {
  if (error instanceof WorkflowPlanParseError) {
    const base = error.causeDetail ?? error.message
    const preview = error.rawContent.trim().slice(0, 240)
    return preview ? `${base} | rawPreview: ${preview}` : base
  }
  if (error instanceof z.ZodError) {
    return `SchemaValidationError: ${formatZodIssues(error)}`
  }
  if (error instanceof Error) return error.message || error.name
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function logPlanCrashReason(error: unknown, context: string) {
  console.error("🔥🔥🔥 PLAN_CRASH_REASON:", error)
  console.error(`🔥 PLAN_CRASH_CONTEXT: ${context}`)
  console.error("🔥 PLAN_CRASH_DETAIL:", formatPlanCrashDetail(error))
}

export function keyForActiveProvider(runtimeKeys: AgentExecutorDeps["runtimeKeys"] | undefined, providerId: ActiveProviderId) {
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

export function normalizeModelId(providerId: ActiveProviderId, model: string) {
  if (providerId === "deepseek_openai_compat") return "deepseek-chat"
  return (model ?? "").trim()
}

function normalizeOpenAICompatBaseUrl(baseUrl: string | undefined, providerId: "openai" | "deepseek_openai_compat") {
  const b = (baseUrl ?? "").trim().replace(/\/$/, "")
  const fallback = providerId === "openai" ? "https://api.openai.com" : "https://api.deepseek.com"
  const root = b || fallback
  return root.endsWith("/v1") ? root : `${root}/v1`
}

export function isBrowser() {
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

export function runtimeKeysFromEnv(): RuntimeKeys {
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

export function normalizeOpenAICompatBaseUrlWithProxy(
  baseUrl: string | undefined,
  providerId: "openai" | "deepseek_openai_compat"
) {
  const proxy = proxyBaseForProvider(providerId)
  if (proxy) {
    if (providerId === "deepseek_openai_compat") return "/api/proxy/deepseek/v1"
    return proxy.endsWith("/v1") ? proxy : `${proxy}/v1`
  }
  return normalizeOpenAICompatBaseUrl(baseUrl, providerId)
}

export function providerSelfIntro(active: ActiveProviderConfig) {
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

export function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

export function clampTextByChars(text: string, limit: number | undefined) {
  const lim = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (!lim) return text
  if (text.length <= lim) return text
  return text.slice(0, lim) + "\n\n[...truncated by contextLimit...]"
}

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

export function extractLlmHistory(messages: ChatHistoryEntry[] | undefined, currentUserInput: string): LlmHistoryMessage[] {
  if (!messages?.length) return []
  const current = currentUserInput.trim()
  const out: LlmHistoryMessage[] = []

  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue
    const content = (m.content ?? "").trim()
    if (!content) continue
    out.push({ role: m.role, content: m.content })
  }

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

export function trimHistoryToContextLimit(
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

export function buildLlmMessages(history: LlmHistoryMessage[], currentUserContent: string): LlmHistoryMessage[] {
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

export async function rewriteResearchSearchQuery(
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

export function serializeSubtaskForReasoning(r: { id: string; ok: boolean; summary: string; output?: unknown }) {
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

export function buildGenModelForActiveProvider(
  active: ActiveProviderConfig,
  runtimeKeys: AgentExecutorDeps["runtimeKeys"] | undefined,
  modelOverride?: string
): GenModel {
  const normalizedModel = modelOverride ?? normalizeModelId(active.providerId, active.model)
  const apiKey = (keyForActiveProvider(runtimeKeys, active.providerId) ?? "").trim()

  if (active.providerId === "ollama") {
    return createOllama({ baseURL: active.baseUrl })(active.model)
  }
  if (!apiKey) throw new Error("MissingApiKey")
  if (active.providerId === "anthropic") {
    return createAnthropic({ apiKey, baseURL: active.baseUrl, fetch: PROXY_SDK_FETCH })(normalizedModel)
  }
  if (active.providerId === "google") {
    return createGoogleGenerativeAI({ apiKey, baseURL: active.baseUrl, fetch: PROXY_SDK_FETCH })(normalizedModel)
  }
  if (active.providerId === "openai" || active.providerId === "deepseek_openai_compat") {
    return createOpenAI({
      apiKey,
      fetch: PROXY_SDK_FETCH,
      baseURL: normalizeOpenAICompatBaseUrlWithProxy(active.baseUrl, active.providerId),
    }).chat(normalizedModel)
  }
  throw new Error("UnsupportedProvider")
}

export async function generatePlanTextWithStructuredFallback(input: {
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

export function buildGenModelForCloudInference(
  active: ActiveProviderConfig,
  runtimeKeys: AgentExecutorDeps["runtimeKeys"] | undefined,
  node: { metadata?: Record<string, unknown> }
): GenModel {
  const fromMeta =
    node.metadata && typeof node.metadata["inferenceModel"] === "string"
      ? String(node.metadata["inferenceModel"]).trim()
      : ""
  const modelId =
    fromMeta ||
    (active.providerId !== "ollama" ? normalizeModelId(active.providerId, active.model) : "deepseek-chat")

  if (active.providerId !== "ollama") {
    return buildGenModelForActiveProvider(active, runtimeKeys, modelId)
  }

  const dsKey = runtimeKeys?.deepseek?.trim()
  if (!dsKey) throw new Error("MissingApiKey")
  return createOpenAI({
    apiKey: dsKey,
    fetch: PROXY_SDK_FETCH,
    baseURL: normalizeOpenAICompatBaseUrlWithProxy(undefined, "deepseek_openai_compat"),
  }).chat(modelId)
}
