import { useAgentStore } from "@/store/useAgentStore"
import { proxyAwareFetch } from "@/lib/proxy-client"

/**
 * 网关请求层（参考 Maoxuan-Changzheng test.html）：
 * - 凭证仅存 session / 内存，fetch 时从 store 动态读取
 * - 无 decrypt / 二次加密
 * - 401/403 统一 Toast + 可分类错误
 */

export type ChatRole = "system" | "user" | "assistant"

export type ChatMessage = {
  role: ChatRole
  content: string
}

export type ProviderId = "ollama" | "openai" | "anthropic" | "google" | "deepseek_openai_compat"

export type ProviderConfig = {
  providerId: ProviderId
  model: string
  /**
   * For browser-only mode:
   * - Ollama: typically http://localhost:11434
   * - OpenAI-compatible: your own CORS-enabled gateway/proxy URL (privacy policy allows client-direct only).
   */
  baseUrl?: string
}

export type GenerateStreamInput = {
  provider: ProviderConfig
  apiKey?: string
  messages: ChatMessage[]
  signal?: AbortSignal
  temperature?: number
  /**
   * DeepSeek（OpenAI 兼容）等供应商：在请求体中加入 `response_format: { type: "json_object" }`。
   * 仅应在需要结构化 JSON 输出时开启；普通对话流式勿开。
   */
  responseFormatJsonObject?: boolean
}

export type TextStream = AsyncIterable<string>

/** 与 AgentExecutor streamText 对齐：流式 HTTP 最长等待 60s。 */
export const LLM_GATEWAY_STREAM_TIMEOUT_MS = 60_000

export type ConnectionTestResult =
  | { ok: true; latencyMs: number }
  | { ok: false; reason: string; status?: number; detail?: string }

export type ValidateProviderResult = {
  ok: boolean
  latencyMs: number
  status?: number
  /**
   * Error classification for UI:
   * - unauthorized: 401/403
   * - model_not_found: 404 (or payload indicates model missing)
   * - cors: browser blocked / failed-to-fetch
   * - http_error: other non-2xx
   * - missing_key: no apiKey provided for cloud provider
   * - unknown
   */
  kind?: "ok" | "unauthorized" | "model_not_found" | "cors" | "http_error" | "missing_key" | "unknown"
  detail?: string
}

function normalizeBaseUrl(baseUrl?: string) {
  if (!baseUrl) return ""
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

function isLikelyModelMismatch(text: string) {
  const t = text.toLowerCase()
  return (
    t.includes("model") &&
    (t.includes("not found") ||
      t.includes("does not exist") ||
      t.includes("not exist") ||
      t.includes("unknown") ||
      t.includes("invalid") ||
      t.includes("no such"))
  )
}

async function safeText(res: Response) {
  return await res.text().catch(() => "")
}

function safeTrim(s: string | undefined | null) {
  return typeof s === "string" ? s.trim() : ""
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function vendorProxyPrefix(providerId: ProviderId) {
  switch (providerId) {
    case "openai":
      return "/api/proxy/openai"
    case "deepseek_openai_compat":
      // rewrites: /api/proxy/deepseek/:path* -> https://api.deepseek.com/:path*（路径须含 /v1/...）
      return "/api/proxy/deepseek"
    case "anthropic":
      return "/api/proxy/anthropic"
    case "google":
      return "/api/proxy/google"
    default:
      return null
  }
}

function maybeProxyBaseUrl(providerId: ProviderId, baseUrl: string) {
  // Force same-origin proxy for ALL cloud providers in browser to bypass CORS.
  // (Server-side fetch can still use absolute URLs; browser must go through rewrites.)
  if (!isBrowser()) return baseUrl
  const p = vendorProxyPrefix(providerId)
  return p ? p : baseUrl
}

function openAICompatChatCompletionsUrl(baseUrl: string) {
  const b = normalizeBaseUrl(baseUrl)
  // next.config rewrites: /api/proxy/deepseek/:path* -> https://api.deepseek.com/:path*（须自带 /v1）
  if (b === "/api/proxy/deepseek") return "/api/proxy/deepseek/v1/chat/completions"
  if (b.startsWith("/api/proxy/deepseek/v1")) {
    return b.endsWith("/chat/completions") ? b : `${b.replace(/\/$/, "")}/chat/completions`
  }
  return b.endsWith("/v1") ? `${b}/chat/completions` : `${b}/v1/chat/completions`
}

export class GatewayAuthError extends Error {
  readonly code = "InvalidApiKey" as const
  constructor(
    public readonly status: number,
    public readonly detail: string
  ) {
    super(`InvalidApiKey:${status}:${detail}`)
    this.name = "GatewayAuthError"
  }
}

export class GatewayMissingKeyError extends Error {
  readonly code = "MissingApiKey" as const
  constructor() {
    super("MissingApiKey")
    this.name = "GatewayMissingKeyError"
  }
}

type CloudProviderId = Exclude<ProviderId, "ollama">

async function parseApiErrorDetail(res: Response): Promise<string> {
  const text = await safeText(res)
  if (!text) return res.statusText || `HTTP ${res.status}`
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; message?: string }
    return j.error?.message ?? j.message ?? text
  } catch {
    return text
  }
}

function notifyAuthFailure(detail: string, status: number) {
  if (!isBrowser()) return
  useAgentStore.getState().actions.notifyAuthFailure(detail, status)
}

function notifyMissingKey() {
  if (!isBrowser()) return
  useAgentStore.getState().actions.pushToast({
    messageKey: "gateway.toast.missingKey",
    variant: "error",
    ttlMs: 6200,
  })
}

type RuntimeKeysExt = {
  deepseek?: string
  deepseek_openai_compat?: string
  openai?: string
  anthropic?: string
  google?: string
}

/** 请求前从 store 同步读取明文 Key（无加解密） */
function resolveCloudApiKey(providerId: CloudProviderId, passedKey?: string): string {
  if (!isBrowser()) {
    const key = safeTrim(passedKey)
    if (!key || key.length < 10) throw new GatewayMissingKeyError()
    return key
  }

  const state = useAgentStore.getState()
  const rk = state.runtimeKeys as RuntimeKeysExt | null
  const settingsApiKey = safeTrim((state.settings as { apiKey?: string }).apiKey)

  let apiKey = ""
  if (providerId === "deepseek_openai_compat") {
    apiKey = safeTrim(rk?.deepseek_openai_compat) || safeTrim(rk?.deepseek) || settingsApiKey
  } else if (providerId === "openai") {
    apiKey = safeTrim(rk?.openai) || settingsApiKey
  } else if (providerId === "anthropic") {
    apiKey = safeTrim(rk?.anthropic) || settingsApiKey
  } else if (providerId === "google") {
    apiKey = safeTrim(rk?.google) || settingsApiKey
  }

  if (!apiKey || apiKey.length < 10) {
    notifyMissingKey()
    throw new GatewayMissingKeyError()
  }
  return apiKey.trim()
}

function bearerAuthHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  }
}

/** 统一 fetch 拦截：认证失败时触发可观测 Toast */
async function gatewayFetch(
  url: string,
  init: RequestInit,
  ctx: { providerId: ProviderId }
): Promise<Response> {
  const res = await proxyAwareFetch(url, init)
  if (res.status === 401 || res.status === 403) {
    const detail = await parseApiErrorDetail(res)
    notifyAuthFailure(detail, res.status)
    throw new GatewayAuthError(res.status, detail)
  }
  return res
}

async function assertOkOrThrow(res: Response, label: string, providerId: ProviderId) {
  if (res.ok) return
  const detail = await parseApiErrorDetail(res)
  if (res.status === 401 || res.status === 403) {
    notifyAuthFailure(detail, res.status)
    throw new GatewayAuthError(res.status, detail)
  }
  throw new Error(`${label}:${res.status}:${detail}`)
}

function anthropicAuthHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim()
  return {
    "Content-Type": "application/json",
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  }
}

function readErrorCode(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined
  const rec = e as Record<string, unknown>
  if (typeof rec.code === "string") return rec.code
  if (rec.cause && typeof rec.cause === "object") {
    const cause = rec.cause as Record<string, unknown>
    if (typeof cause.code === "string") return cause.code
  }
  return undefined
}

function classifyOllamaError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "")
  const lower = msg.toLowerCase()
  const code = readErrorCode(e)
  const isConnRefused =
    code === "ECONNREFUSED" || lower.includes("econnrefused") || lower.includes("connect econnrefused")
  const isCorsLike = lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed")
  return { code, isConnRefused, isCorsLike, msg }
}

/**
 * 连接拨测：对指定供应商发送极简 prompt（ping），max_tokens=1。
 * - 成功：返回 latencyMs
 * - 失败：返回 reason/status/detail（供 UI 做本地化映射）
 */
export async function testConnection(
  providerId: ProviderId,
  modelId: string,
  opts?: { baseUrl?: string; apiKey?: string; signal?: AbortSignal }
): Promise<ConnectionTestResult> {
  const v = await validateProvider(providerId, modelId, opts)
  if (v.ok) return { ok: true, latencyMs: v.latencyMs }
  if (v.kind === "missing_key") return { ok: false, reason: "MissingApiKey", status: v.status, detail: v.detail }
  if (v.kind === "unauthorized") return { ok: false, reason: "InvalidApiKey", status: v.status, detail: v.detail }
  if (v.kind === "model_not_found") return { ok: false, reason: "ModelMismatch", status: v.status, detail: v.detail }
  if (v.kind === "cors") return { ok: false, reason: "NetworkError", status: v.status, detail: v.detail }
  if (v.kind === "http_error") return { ok: false, reason: "HttpError", status: v.status, detail: v.detail }
  return { ok: false, reason: "UnknownError", status: v.status, detail: v.detail }
}

export async function validateProvider(
  providerId: ProviderId,
  modelId: string,
  opts?: { baseUrl?: string; apiKey?: string; signal?: AbortSignal }
): Promise<ValidateProviderResult> {
  const model = safeTrim(modelId)
  const base = normalizeBaseUrl(opts?.baseUrl)
  const key = safeTrim(opts?.apiKey)
  const startedAt = performance.now()

  if (!model) return { ok: false, latencyMs: 0, kind: "http_error", status: 400, detail: "EmptyModel" }

  const wrap = async (fn: () => Promise<Response>, ctx?: { label?: string }): Promise<ValidateProviderResult> => {
    try {
      const res = await fn()
      const latencyMs = Math.round(performance.now() - startedAt)
      if (res.ok) return { ok: true, latencyMs, kind: "ok", status: res.status }

      const text = await safeText(res)
      const detail = text || res.statusText
      const is401 = res.status === 401 || res.status === 403
      const is404 = res.status === 404 || isLikelyModelMismatch(detail)

      return {
        ok: false,
        latencyMs,
        status: res.status,
        kind: is401 ? "unauthorized" : is404 ? "model_not_found" : "http_error",
        detail,
      }
    } catch (e) {
      const latencyMs = Math.round(performance.now() - startedAt)
      if (e instanceof GatewayAuthError) {
        return {
          ok: false,
          latencyMs,
          status: e.status,
          kind: "unauthorized",
          detail: e.detail,
        }
      }
      if (e instanceof GatewayMissingKeyError) {
        return { ok: false, latencyMs: 0, kind: "missing_key", status: 401, detail: "MissingApiKey" }
      }
      const msg = e instanceof Error ? e.message : String(e)
      const lower = msg.toLowerCase()
      const isCorsLike =
        lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed")

      if (providerId === "ollama") {
        const c = classifyOllamaError(e)
        console.log("[Ollama] Connection probe failed", {
          kind: c.isConnRefused ? "ECONNREFUSED" : c.isCorsLike ? "CORS_OR_FETCH_FAILED" : "UNKNOWN",
          code: c.code,
          message: c.msg,
          error: e,
          ctx,
        })
      } else if (ctx?.label) {
        console.error(`[ProviderProbe] ${ctx.label} failed`, e)
      }

      return { ok: false, latencyMs, kind: isCorsLike ? "cors" : "unknown", detail: msg }
    }
  }

  if (providerId === "ollama") {
    const b = base || "http://localhost:11434"
    return await wrap(
      () =>
      fetch(`${b}/api/chat`, {
        method: "POST",
        signal: opts?.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "user", content: "ping" }],
          options: { num_predict: 1 },
        }),
      })
    )
  }

  if (providerId === "openai" || providerId === "deepseek_openai_compat") {
    let apiKey: string
    try {
      apiKey = resolveCloudApiKey(providerId, key)
    } catch (e) {
      if (e instanceof GatewayMissingKeyError) {
        return { ok: false, latencyMs: 0, kind: "missing_key", status: 401, detail: "MissingApiKey" }
      }
      throw e
    }
    const requestModel = providerId === "deepseek_openai_compat" ? "deepseek-chat" : model
    const raw = base || (providerId === "openai" ? "https://api.openai.com/v1" : "https://api.deepseek.com/v1")
    const b = maybeProxyBaseUrl(providerId, raw)
    return await wrap(
      () =>
        gatewayFetch(
          openAICompatChatCompletionsUrl(b),
          {
            method: "POST",
            signal: opts?.signal,
            headers: bearerAuthHeaders(apiKey),
            body: JSON.stringify({
              model: requestModel,
              max_tokens: 1,
              stream: false,
              messages: [{ role: "user", content: "ping" }],
            }),
          },
          { providerId }
        ),
      { label: providerId }
    )
  }

  if (providerId === "anthropic") {
    let anthropicKey: string
    try {
      anthropicKey = resolveCloudApiKey("anthropic", opts?.apiKey)
    } catch (e) {
      if (e instanceof GatewayMissingKeyError) {
        return { ok: false, latencyMs: 0, kind: "missing_key", status: 401, detail: "MissingApiKey" }
      }
      throw e
    }
    const raw = base || "https://api.anthropic.com"
    const b = maybeProxyBaseUrl(providerId, raw)
    return await wrap(
      () =>
        gatewayFetch(
          `${b}/v1/messages`,
          {
            method: "POST",
            signal: opts?.signal,
            headers: anthropicAuthHeaders(anthropicKey),
            body: JSON.stringify({
              model,
              max_tokens: 1,
              stream: false,
              messages: [{ role: "user", content: "ping" }],
            }),
          },
          { providerId }
        ),
      { label: providerId }
    )
  }

  if (providerId === "google") {
    let googleKey: string
    try {
      googleKey = resolveCloudApiKey("google", opts?.apiKey)
    } catch (e) {
      if (e instanceof GatewayMissingKeyError) {
        return { ok: false, latencyMs: 0, kind: "missing_key", status: 401, detail: "MissingApiKey" }
      }
      throw e
    }
    const raw = base || "https://generativelanguage.googleapis.com"
    const b = maybeProxyBaseUrl(providerId, raw)
    const enc = encodeURIComponent(model)
    const qp = new URLSearchParams()
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const gKey = safeTrim(googleKey)
    if (gKey.startsWith("AIza")) qp.set("key", gKey)
    else if (gKey) headers.authorization = `Bearer ${gKey}`

    return await wrap(
      () =>
        gatewayFetch(
          `${b}/v1beta/models/${enc}:generateContent?${qp.toString()}`,
          {
            method: "POST",
            signal: opts?.signal,
            headers,
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: "ping" }] }],
              generationConfig: { maxOutputTokens: 1 },
            }),
          },
          { providerId }
        ),
      { label: providerId }
    )
  }

  return { ok: false, latencyMs: 0, kind: "unknown", status: 400, detail: "UnsupportedProvider" }
}

function mergeAbortSignals(primary?: AbortSignal, timeoutMs = LLM_GATEWAY_STREAM_TIMEOUT_MS): AbortSignal | undefined {
  const signals: AbortSignal[] = []
  if (primary) signals.push(primary)
  if (typeof AbortSignal.timeout === "function") {
    signals.push(AbortSignal.timeout(timeoutMs))
  }
  if (signals.length === 0) return undefined
  if (signals.length === 1) return signals[0]
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals)
  return primary
}

function warnSkippedStreamChunk(label: string, chunk: unknown, err?: unknown) {
  if (err !== undefined) console.warn(`跳过未知流片段 (${label}):`, chunk, err)
  else console.warn(`跳过未知流片段 (${label}):`, chunk)
}

async function* readNdjsonStream(res: Response): TextStream {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    while (true) {
      const idx = buf.indexOf("\n")
      if (idx < 0) break
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (!line) continue
      yield line
    }
  }
  const tail = buf.trim()
  if (tail) yield tail
}

async function* readSseDataLines(res: Response): TextStream {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    // SSE events are separated by a blank line (\n\n). Some providers only use `data:` lines.
    while (true) {
      const sep = buf.indexOf("\n\n")
      if (sep < 0) break
      const rawEvent = buf.slice(0, sep)
      buf = buf.slice(sep + 2)

      const lines = rawEvent.split("\n")
      const dataLines: string[] = []
      for (const line of lines) {
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
      }
      const data = dataLines.join("\n").trim()
      if (data) yield data
    }
  }

  const tail = buf.trim()
  if (!tail) return
  const lines = tail.split("\n")
  const dataLines: string[] = []
  for (const line of lines) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
  }
  const data = dataLines.join("\n").trim()
  if (data) yield data
}

type SseEvent = {
  event?: string
  data: string
}

async function* readSseEvents(res: Response): AsyncIterable<SseEvent> {
  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ""

  const flushEvent = function* (raw: string): Generator<SseEvent> {
    const lines = raw.split("\n")
    let eventName: string | undefined
    const dataLines: string[] = []
    for (const line of lines) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim()
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
    }
    const data = dataLines.join("\n").trim()
    if (!data) return
    yield { event: eventName, data }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    while (true) {
      const sep = buf.indexOf("\n\n")
      if (sep < 0) break
      const rawEvent = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      yield* flushEvent(rawEvent)
    }
  }
  const tail = buf.trim()
  if (tail) yield* flushEvent(tail)
}

function toOllamaMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

async function* generateOllamaStream(input: GenerateStreamInput): TextStream {
  const base = normalizeBaseUrl(input.provider.baseUrl) || "http://localhost:11434"
  const url = `${base}/api/chat`

  const res = await fetch(url, {
    method: "POST",
    signal: mergeAbortSignals(input.signal),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: input.provider.model,
      messages: toOllamaMessages(input.messages),
      stream: true,
      options: typeof input.temperature === "number" ? { temperature: input.temperature } : undefined,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`OllamaError:${res.status}:${text || res.statusText}`)
  }

  for await (const line of readNdjsonStream(res)) {
    try {
      const json = JSON.parse(line) as {
        message?: { content?: string; reasoning?: string; reasoning_content?: string }
        done?: boolean
      }
      const delta =
        json.message?.content ??
        json.message?.reasoning ??
        json.message?.reasoning_content ??
        ""
      if (delta) yield delta
      if (json.done) break
    } catch (e) {
      warnSkippedStreamChunk("ollama-ndjson", line, e)
    }
  }
}

async function* generateOpenAICompatStream(input: GenerateStreamInput): TextStream {
  const rawBase = normalizeBaseUrl(input.provider.baseUrl) || "https://api.openai.com/v1"
  const base = maybeProxyBaseUrl(input.provider.providerId, rawBase)
  const url = openAICompatChatCompletionsUrl(base)
  const pid = input.provider.providerId
  if (pid !== "openai" && pid !== "deepseek_openai_compat") throw new Error("UnsupportedProvider")
  const apiKey = resolveCloudApiKey(pid, input.apiKey)

  const body: Record<string, unknown> = {
    model: pid === "deepseek_openai_compat" ? "deepseek-chat" : input.provider.model,
    messages: input.messages,
    stream: true,
    temperature: input.temperature,
  }
  if (input.responseFormatJsonObject === true && pid === "deepseek_openai_compat") {
    body.response_format = { type: "json_object" }
  }

  const res = await gatewayFetch(
    url,
    {
      method: "POST",
      signal: mergeAbortSignals(input.signal),
      headers: bearerAuthHeaders(apiKey),
      body: JSON.stringify(body),
    },
    { providerId: pid }
  )

  await assertOkOrThrow(res, "OpenAICompatError", pid)

  for await (const data of readSseDataLines(res)) {
    if (data === "[DONE]") break
    try {
      const json = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string | null; reasoning_content?: string | null; tool_calls?: unknown }
          finish_reason?: string | null
        }>
        references?: unknown
        tool_result?: unknown
      }
      const choice = json.choices?.[0]
      const delta = choice?.delta
      const text =
        (typeof delta?.content === "string" ? delta.content : "") ||
        (typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "")
      if (text) yield text
      if (choice?.delta?.tool_calls || json.references || json.tool_result) {
        // 非文本 SSE 帧：吸收并继续，绝不 break 整个 reader 循环
        continue
      }
    } catch (e) {
      warnSkippedStreamChunk("openai-compat-sse", data, e)
    }
  }
}

type AnthropicSseEvent = {
  type: string
  delta?: { type?: string; text?: string }
}

function splitAnthropicMessages(messages: ChatMessage[]) {
  let system = ""
  const out: Array<{ role: "user" | "assistant"; content: string }> = []
  for (const m of messages) {
    if (m.role === "system") {
      system = `${system}${system.trim().length > 0 ? "\n" : ""}${m.content}`
      continue
    }
    if (m.role === "user" || m.role === "assistant") {
      out.push({ role: m.role, content: m.content })
    }
  }
  return { system: system.trim() ? system : undefined, messages: out }
}

async function* generateAnthropicMessagesStream(input: GenerateStreamInput): TextStream {
  const rawBase = normalizeBaseUrl(input.provider.baseUrl) || "https://api.anthropic.com"
  const base = maybeProxyBaseUrl(input.provider.providerId, rawBase)
  const url = `${base}/v1/messages`
  const key = resolveCloudApiKey("anthropic", input.apiKey)

  const { system, messages } = splitAnthropicMessages(input.messages)

  const res = await gatewayFetch(
    url,
    {
      method: "POST",
      signal: mergeAbortSignals(input.signal),
      headers: { ...anthropicAuthHeaders(key), accept: "text/event-stream" },
      body: JSON.stringify({
        model: input.provider.model,
        max_tokens: 1024,
        stream: true,
        temperature: input.temperature,
        system,
        messages,
      }),
    },
    { providerId: "anthropic" }
  )

  await assertOkOrThrow(res, "AnthropicError", "anthropic")

  for await (const evt of readSseEvents(res)) {
    // Anthropic uses named SSE events; JSON also includes `type`.
    let parsed: AnthropicSseEvent | null = null
    try {
      parsed = JSON.parse(evt.data) as AnthropicSseEvent
    } catch {
      parsed = null
    }
    if (!parsed) continue

    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
      const t = parsed.delta.text ?? ""
      if (t) yield t
      continue
    }

    if (parsed.type === "error") {
      warnSkippedStreamChunk("anthropic-sse", evt.data)
      throw new Error(`AnthropicStreamError:${evt.data}`)
    }

    // message_start / tool_use / citation 等非文本帧：吸收并继续读流
    continue
  }
}

function splitGeminiRoles(messages: ChatMessage[]) {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = []
  let system = ""

  for (const m of messages) {
    if (m.role === "system") {
      system = `${system}${system.trim().length > 0 ? "\n" : ""}${m.content}`
      continue
    }
    const role = m.role === "assistant" ? "model" : "user"
    contents.push({ role, parts: [{ text: m.content }] })
  }

  return { systemInstruction: system.trim() ? { parts: [{ text: system }] } : undefined, contents }
}

function geminiUrl(base: string, model: string, apiKey: string) {
  const raw = normalizeBaseUrl(base) || "https://generativelanguage.googleapis.com"
  const b = maybeProxyBaseUrl("google", raw)
  const encModel = encodeURIComponent(model)
  const key = safeTrim(apiKey)
  const qp = new URLSearchParams()
  qp.set("alt", "sse")
  if (key.startsWith("AIza")) qp.set("key", key)
  return `${b}/v1beta/models/${encModel}:streamGenerateContent?${qp.toString()}`
}

async function* generateGeminiStream(input: GenerateStreamInput): TextStream {
  const key = resolveCloudApiKey("google", input.apiKey)

  const url = geminiUrl(input.provider.baseUrl ?? "", input.provider.model, key)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "text/event-stream",
  }
  const gKey = safeTrim(key)
  if (gKey && !gKey.startsWith("AIza")) headers.authorization = `Bearer ${gKey}`

  const { systemInstruction, contents } = splitGeminiRoles(input.messages)

  const res = await gatewayFetch(
    url,
    {
      method: "POST",
      signal: mergeAbortSignals(input.signal),
      headers,
      body: JSON.stringify({
        contents,
        systemInstruction,
        generationConfig:
          typeof input.temperature === "number" ? { temperature: input.temperature } : undefined,
      }),
    },
    { providerId: "google" }
  )

  await assertOkOrThrow(res, "GeminiError", "google")

  let lastText = ""
  for await (const data of readSseDataLines(res)) {
    try {
      const json = JSON.parse(data) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const parts = json.candidates?.[0]?.content?.parts ?? []
      const merged = parts.map((p) => p.text ?? "").join("")
      if (!merged) continue

      // Gemini SSE chunks may repeat cumulative text; emit only the suffix delta.
      if (merged.startsWith(lastText)) {
        const delta = merged.slice(lastText.length)
        lastText = merged
        if (delta) yield delta
      } else {
        lastText = merged
        yield merged
      }
    } catch (e) {
      warnSkippedStreamChunk("gemini-sse", data, e)
    }
  }
}

export function generateStream(input: GenerateStreamInput): TextStream {
  switch (input.provider.providerId) {
    case "ollama":
      return generateOllamaStream(input)
    case "openai":
      return generateOpenAICompatStream(input)
    case "deepseek_openai_compat":
      return generateOpenAICompatStream(input)
    case "anthropic":
      return generateAnthropicMessagesStream(input)
    case "google":
      return generateGeminiStream(input)
    default:
      return (async function* () {
        throw new Error("UnsupportedProvider")
      })()
  }
}

