import { hasValidAuthSession } from "@/lib/session-auth"

/** Upstream base URLs for /api/proxy/[provider]/... */
export const PROXY_PROVIDER_UPSTREAM: Record<string, string> = {
  deepseek: "https://api.deepseek.com",
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  tavily: "https://api.tavily.com",
  serper: "https://google.serper.dev",
}

export type ProxyAuthResult =
  | { ok: true }
  | { ok: false; status: number; message: string }

export type ProxyRateLimitResult =
  | { ok: true }
  | { ok: false; status: number; message: string }

const DEFAULT_RATE_LIMIT_PER_MIN = 60
const RATE_WINDOW_MS = 60_000

/**
 * 内存限流表的条目硬上限。
 *
 * 原实现只有 `set` 没有 `delete`：每个出现过的客户端 IP 都会永久占一条，
 * 进程活多久表就长多久。单实例长期运行时这是稳定的内存增长，
 * 且 `x-forwarded-for` 可伪造，等于允许外部控制 key 空间。
 */
export const RATE_LIMIT_BUCKET_MAX = 10_000

const rateBuckets = new Map<string, { count: number; windowStartMs: number }>()
let lastPruneMs = 0

/** 每个窗口周期最多清理一次，避免每次请求都全表扫描。 */
function maybePruneExpired(nowMs: number) {
  if (nowMs - lastPruneMs < RATE_WINDOW_MS) return
  lastPruneMs = nowMs
  pruneExpiredBuckets(nowMs)
}

/** 清掉窗口已过期的条目；这些条目即使保留也不会再被命中。 */
function pruneExpiredBuckets(nowMs: number) {
  for (const [ip, bucket] of rateBuckets) {
    if (nowMs - bucket.windowStartMs >= RATE_WINDOW_MS) rateBuckets.delete(ip)
  }
}

/**
 * 保证表大小不超过上限。
 * 若清理过期条目后仍然超限（一分钟内有超过 1 万个不同来源，本身即异常），
 * 则按插入顺序淘汰最老的条目。代价是被淘汰 IP 的计数被重置，
 * 取舍是「宁可少计一次限流，也不要无界内存增长」。
 */
function enforceBucketBound(nowMs: number) {
  if (rateBuckets.size < RATE_LIMIT_BUCKET_MAX) return
  pruneExpiredBuckets(nowMs)
  while (rateBuckets.size >= RATE_LIMIT_BUCKET_MAX) {
    const oldest = rateBuckets.keys().next()
    if (oldest.done) break
    rateBuckets.delete(oldest.value)
  }
}

function readProxyAccessToken(): string | undefined {
  const raw = process.env.PROXY_ACCESS_TOKEN
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0 ? trimmed : undefined
}

function readRateLimitPerMin(): number {
  const raw = process.env.PROXY_RATE_LIMIT_PER_MIN
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_RATE_LIMIT_PER_MIN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RATE_LIMIT_PER_MIN
}

export function isKnownProxyProvider(provider: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROXY_PROVIDER_UPSTREAM, provider)
}

export function resolveProxyUpstreamUrl(provider: string, pathSegments: string[]): string | null {
  const base = PROXY_PROVIDER_UPSTREAM[provider]
  if (!base) return null
  const suffix = pathSegments.map((s) => encodeURIComponent(s)).join("/")
  return suffix ? `${base}/${suffix}` : base
}

/* ------------------------------------------------------------------ *
 * 请求体上限与上游超时
 *
 * 转发前的 `await req.arrayBuffer()` 没有任何体积上限：App Router 的
 * route handler 不像 Server Actions 有 body 体积兜底，限流又按可伪造的
 * `x-forwarded-for` 计数。未配置 PROXY_ACCESS_TOKEN 时该路由默认放行，
 * 于是任何人都能用并发的大请求体把进程内存打满。
 * ------------------------------------------------------------------ */

export class ProxyBodyTooLargeError extends Error {
  readonly status = 413 as const
  constructor(
    readonly limitBytes: number,
    readonly seenBytes: number
  ) {
    super(`ProxyBodyTooLarge: ${seenBytes} > ${limitBytes}`)
    this.name = "ProxyBodyTooLargeError"
  }
}

/** 32 MiB：足够容纳超长上下文的多模态请求，又远低于会威胁进程的量级。 */
export const DEFAULT_PROXY_MAX_BODY_BYTES = 32 * 1024 * 1024
/** 上游是 LLM 流式接口，首字节可能很慢；给 2 分钟，但不允许无限挂起。 */
export const DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS = 120_000

function readPositiveIntEnv(name: string): number | null {
  const raw = process.env[name]
  if (typeof raw !== "string") return null
  const n = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function resolveProxyMaxBodyBytes(): number {
  return readPositiveIntEnv("PROXY_MAX_BODY_BYTES") ?? DEFAULT_PROXY_MAX_BODY_BYTES
}

export function resolveProxyUpstreamTimeoutMs(): number {
  return readPositiveIntEnv("PROXY_UPSTREAM_TIMEOUT_MS") ?? DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS
}

/**
 * 有界读取请求体。
 *
 * 先看 `content-length` 做快速拒绝（该头部可被伪造，因此只用于提前失败，
 * 不作为放行依据）；随后边读边累加，任一分片越界立即取消剩余读取。
 */
export async function readBoundedRequestBody(
  req: Request,
  maxBytes = resolveProxyMaxBodyBytes()
): Promise<ArrayBuffer> {
  const declaredRaw = req.headers.get("content-length")
  const declared = declaredRaw === null ? Number.NaN : Number.parseInt(declaredRaw, 10)
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ProxyBodyTooLargeError(maxBytes, declared)
  }
  if (!req.body) return new ArrayBuffer(0)

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) throw new ProxyBodyTooLargeError(maxBytes, total)
      chunks.push(value)
    }
  } catch (e) {
    await reader.cancel().catch(() => undefined)
    throw e
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out.buffer as ArrayBuffer
}

function readBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization")
  if (!auth) return null
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() ?? null
}

function readProxyTokenHeader(req: Request): string | null {
  return req.headers.get("x-scholarkernel-proxy-token")?.trim() ?? null
}

/** Whether proxy auth must succeed before forwarding. Only when PROXY_ACCESS_TOKEN is explicitly set. */
export function isProxyAuthRequired(): boolean {
  return Boolean(readProxyAccessToken())
}

export async function checkProxyAuth(req: Request): Promise<ProxyAuthResult> {
  if (await hasValidAuthSession(req)) return { ok: true }

  const configured = readProxyAccessToken()
  // 未配置 PROXY_ACCESS_TOKEN → 直连降级：放行转发，不阻断工作流
  if (!configured) return { ok: true }

  const presented = readBearerToken(req) ?? readProxyTokenHeader(req)
  if (presented !== configured) {
    return { ok: false, status: 401, message: "Unauthorized proxy access" }
  }
  return { ok: true }
}

export function resolveClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = req.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  return "local"
}

export function checkRateLimit(clientIp: string, nowMs = Date.now()): ProxyRateLimitResult {
  const limit = readRateLimitPerMin()
  const windowMs = RATE_WINDOW_MS
  maybePruneExpired(nowMs)
  enforceBucketBound(nowMs)
  const bucket = rateBuckets.get(clientIp)

  if (!bucket || nowMs - bucket.windowStartMs >= windowMs) {
    rateBuckets.set(clientIp, { count: 1, windowStartMs: nowMs })
    return { ok: true }
  }

  if (bucket.count >= limit) {
    return { ok: false, status: 429, message: "Rate limit exceeded" }
  }

  bucket.count += 1
  return { ok: true }
}

export function logProxyRequest(input: {
  provider: string
  path: string
  status: number
  clientIp: string
}) {
  console.info(
    `[proxy] provider=${input.provider} path=/${input.path} status=${input.status} ip=${input.clientIp}`
  )
}

/** Test-only helper to reset in-memory counters. */
export function resetProxyRateLimitsForTests() {
  rateBuckets.clear()
  lastPruneMs = 0
}

/** Test-only helper：观察限流表规模，用于断言其有界。 */
export function proxyRateLimitBucketCountForTests(): number {
  return rateBuckets.size
}
