import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"
import type { NextRequest } from "next/server"

/** Core write APIs: new conversation, send message, agent triggers. */
export const CORE_API_RATE_LIMIT = 15
export const CORE_API_RATE_WINDOW = "1 m" as const

export const rateLimitExceededBody = {
  error: "Too Many Requests",
  message: "您的学术操作过于频繁，请稍后再试。",
} as const

export type RateLimitCheckResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

export type RateLimitLimiter = {
  limit: (key: string) => Promise<RateLimitCheckResult>
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

let cachedLimiter: RateLimitLimiter | null | undefined

function readUpstashEnv(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null
  return { url, token }
}

function createUpstashLimiter(): RateLimitLimiter {
  const env = readUpstashEnv()
  if (!env) {
    return {
      limit: async () => ({
        success: true,
        limit: CORE_API_RATE_LIMIT,
        remaining: CORE_API_RATE_LIMIT,
        reset: Date.now() + 60_000,
      }),
    }
  }

  const redis = new Redis({ url: env.url, token: env.token })
  const ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(CORE_API_RATE_LIMIT, CORE_API_RATE_WINDOW),
    prefix: "sk:core-api",
    analytics: true,
  })

  return {
    limit: async (key: string) => {
      const result = await ratelimit.limit(key)
      return {
        success: result.success,
        limit: result.limit,
        remaining: result.remaining,
        reset: result.reset,
      }
    },
  }
}

export function getCoreApiRateLimiter(): RateLimitLimiter {
  if (cachedLimiter === undefined) {
    cachedLimiter = createUpstashLimiter()
  }
  return cachedLimiter!
}

/** Test-only: replace or reset the cached Upstash limiter. */
export function resetCoreApiRateLimiterForTests(limiter?: RateLimitLimiter | null) {
  cachedLimiter = limiter === undefined ? undefined : limiter
}

export function isCoreApiWriteRequest(pathname: string, method: string): boolean {
  const m = method.toUpperCase()
  if (!WRITE_METHODS.has(m)) return false
  if (pathname === "/api/conversations" && m === "POST") return true
  if (/^\/api\/conversations\/[^/]+\/messages$/.test(pathname) && m === "POST") return true
  if (pathname.startsWith("/api/agent/") && m === "POST") return true
  return false
}

export function resolveClientIp(req: Pick<NextRequest, "headers"> & { ip?: string | null }): string {
  const direct = typeof req.ip === "string" ? req.ip.trim() : ""
  if (direct) return direct

  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }

  const realIp = req.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp

  return "local"
}

export function buildRateLimitKey(ip: string, userId?: string | null): string {
  const uid = typeof userId === "string" ? userId.trim() : ""
  return uid ? `user:${uid}` : `ip:${ip}`
}

export async function checkCoreApiRateLimit(
  key: string,
  limiter: RateLimitLimiter = getCoreApiRateLimiter()
): Promise<RateLimitCheckResult> {
  return limiter.limit(key)
}

export function rateLimitResponseHeaders(result: RateLimitCheckResult): Record<string, string> {
  return {
    "Retry-After": String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(result.reset),
  }
}

/** In-memory sliding window for unit tests (mirrors 15/min burst semantics). */
export class InMemorySlidingWindowLimiter implements RateLimitLimiter {
  private buckets = new Map<string, number[]>()

  constructor(
    private readonly max: number = CORE_API_RATE_LIMIT,
    private readonly windowMs = 60_000
  ) {}

  async limit(key: string, nowMs = Date.now()): Promise<RateLimitCheckResult> {
    const prev = this.buckets.get(key) ?? []
    const active = prev.filter((t) => nowMs - t < this.windowMs)
    if (active.length >= this.max) {
      const reset = (active[0] ?? nowMs) + this.windowMs
      return {
        success: false,
        limit: this.max,
        remaining: 0,
        reset,
      }
    }
    active.push(nowMs)
    this.buckets.set(key, active)
    return {
      success: true,
      limit: this.max,
      remaining: Math.max(0, this.max - active.length),
      reset: nowMs + this.windowMs,
    }
  }

  resetForTests() {
    this.buckets.clear()
  }
}
