import { afterEach, describe, expect, it, vi } from "vitest"

import {
  CORE_API_RATE_LIMIT,
  InMemorySlidingWindowLimiter,
  buildRateLimitKey,
  checkCoreApiRateLimit,
  isCoreApiWriteRequest,
  rateLimitExceededBody,
  resetCoreApiRateLimiterForTests,
  resolveClientIp,
} from "@/lib/ratelimit"

describe("ratelimit", () => {
  afterEach(() => {
    resetCoreApiRateLimiterForTests()
  })

  it("matches core write APIs only", () => {
    expect(isCoreApiWriteRequest("/api/conversations", "POST")).toBe(true)
    expect(isCoreApiWriteRequest("/api/conversations", "GET")).toBe(false)
    expect(isCoreApiWriteRequest("/api/conversations/abc/messages", "POST")).toBe(true)
    expect(isCoreApiWriteRequest("/api/conversations/abc/messages", "DELETE")).toBe(false)
    expect(isCoreApiWriteRequest("/api/agent/run", "POST")).toBe(true)
    expect(isCoreApiWriteRequest("/api/agent/jobs", "GET")).toBe(false)
    expect(isCoreApiWriteRequest("/api/canvas/save", "POST")).toBe(false)
  })

  it("prefers authenticated user id over ip for rate limit key", () => {
    expect(buildRateLimitKey("1.2.3.4", "user-42")).toBe("user:user-42")
    expect(buildRateLimitKey("1.2.3.4", null)).toBe("ip:1.2.3.4")
  })

  it("extracts client ip from forwarded headers", () => {
    const req = new Request("http://localhost/api/conversations", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
    })
    expect(resolveClientIp(req)).toBe("203.0.113.9")
  })

  it("exposes standard 429 JSON body for middleware", () => {
    expect(rateLimitExceededBody).toEqual({
      error: "Too Many Requests",
      message: "您的学术操作过于频繁，请稍后再试。",
    })
  })

  it("blocks the 16th burst request within one second (15/min sliding window)", async () => {
    const limiter = new InMemorySlidingWindowLimiter(CORE_API_RATE_LIMIT, 60_000)
    resetCoreApiRateLimiterForTests(limiter)
    const key = buildRateLimitKey("198.51.100.42")
    const results = await Promise.all(
      Array.from({ length: 50 }, () => checkCoreApiRateLimit(key, limiter))
    )

    const allowed = results.filter((r) => r.success).length
    const blocked = results.filter((r) => !r.success).length

    expect(allowed).toBe(CORE_API_RATE_LIMIT)
    expect(blocked).toBe(50 - CORE_API_RATE_LIMIT)
    expect(results[CORE_API_RATE_LIMIT]?.success).toBe(false)
    expect(results[CORE_API_RATE_LIMIT]?.remaining).toBe(0)
  })

  it("simulates single-ip 50 requests in 1s and cuts off precisely at request 16", async () => {
    const limiter = new InMemorySlidingWindowLimiter(CORE_API_RATE_LIMIT, 60_000)
    const key = "ip:203.0.113.50"
    const baseTs = Date.now()

    const statuses: boolean[] = []
    for (let i = 0; i < 50; i += 1) {
      const result = await limiter.limit(key, baseTs + i)
      statuses.push(result.success)
    }

    expect(statuses.slice(0, 15).every(Boolean)).toBe(true)
    expect(statuses[15]).toBe(false)
    expect(statuses.slice(16).every((ok) => ok === false)).toBe(true)
  })
})

describe("ApiRateLimitError integration", () => {
  it("apiFetch throws ApiRateLimitError on HTTP 429", async () => {
    const { apiFetch, ApiRateLimitError, isApiRateLimitError } = await import("@/lib/api-fetch")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: "Too Many Requests",
            message: "您的学术操作过于频繁，请稍后再试。",
          }),
          { status: 429 }
        )
      )
    )

    await expect(apiFetch("/api/conversations", { method: "POST" })).rejects.toSatisfy((e: unknown) => {
      expect(isApiRateLimitError(e)).toBe(true)
      expect(e).toBeInstanceOf(ApiRateLimitError)
      if (e instanceof ApiRateLimitError) {
        expect(e.userMessage).toContain("过于频繁")
      }
      return true
    })

    vi.unstubAllGlobals()
  })
})
