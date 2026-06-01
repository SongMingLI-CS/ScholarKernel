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
const rateBuckets = new Map<string, { count: number; windowStartMs: number }>()

function isProductionEnv() {
  return process.env.NODE_ENV === "production"
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

function readBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? req.headers.get("Authorization")
  if (!auth) return null
  const m = auth.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() ?? null
}

function readProxyTokenHeader(req: Request): string | null {
  return req.headers.get("x-scholarkernel-proxy-token")?.trim() ?? null
}

/** Whether proxy auth must succeed before forwarding. */
export function isProxyAuthRequired(): boolean {
  return isProductionEnv() || Boolean(readProxyAccessToken())
}

export function checkProxyAuth(req: Request): ProxyAuthResult {
  if (hasValidAuthSession(req)) return { ok: true }

  const configured = readProxyAccessToken()
  if (isProductionEnv() && !configured) {
    return { ok: false, status: 503, message: "PROXY_ACCESS_TOKEN is not configured" }
  }
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
  const windowMs = 60_000
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
}
