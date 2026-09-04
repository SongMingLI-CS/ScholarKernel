import { afterEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/ratelimit", () => ({
  buildRateLimitKey: vi.fn(() => "test"),
  checkCoreApiRateLimit: vi.fn(async () => ({ success: true })),
  isCoreApiWriteRequest: vi.fn(() => false),
  rateLimitExceededBody: { error: "Rate limit exceeded" },
  rateLimitResponseHeaders: vi.fn(() => ({})),
  resolveClientIp: vi.fn(() => "127.0.0.1"),
}))

import { proxy } from "@/proxy"

describe("middleware runtime hardening", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("returns 401 instead of throwing for a malformed Bearer header", async () => {
    vi.stubEnv("AUTH_PASSWORD", "configured")
    vi.stubEnv("AUTH_SECRET", "test-secret-that-is-long-enough")
    const req = new NextRequest("https://example.test/api/conversations", {
      headers: { authorization: "Bearer" },
    })

    const response = await proxy(req)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized", status: 401 })
  })
})
