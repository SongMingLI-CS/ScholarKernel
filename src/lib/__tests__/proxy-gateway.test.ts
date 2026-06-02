import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  checkProxyAuth,
  checkRateLimit,
  isKnownProxyProvider,
  resolveProxyUpstreamUrl,
  resetProxyRateLimitsForTests,
} from "@/lib/proxy-gateway"

describe("proxy-gateway", () => {
  const envSnapshot = { ...process.env }

  beforeEach(() => {
    resetProxyRateLimitsForTests()
    process.env = { ...envSnapshot }
    delete process.env.PROXY_ACCESS_TOKEN
    delete process.env.PROXY_RATE_LIMIT_PER_MIN
    process.env.NODE_ENV = "development"
  })

  afterEach(() => {
    process.env = { ...envSnapshot }
    resetProxyRateLimitsForTests()
  })

  it("allows dev requests when PROXY_ACCESS_TOKEN is unset", async () => {
    const req = new Request("http://localhost/api/proxy/openai/v1/models")
    await expect(checkProxyAuth(req)).resolves.toEqual({ ok: true })
  })

  it("requires bearer token when PROXY_ACCESS_TOKEN is set", async () => {
    process.env.PROXY_ACCESS_TOKEN = "secret-proxy-token"
    const unauth = new Request("http://localhost/api/proxy/openai/v1/models")
    await expect(checkProxyAuth(unauth)).resolves.toEqual({ ok: false, status: 401, message: "Unauthorized proxy access" })

    const authed = new Request("http://localhost/api/proxy/openai/v1/models", {
      headers: { Authorization: "Bearer secret-proxy-token" },
    })
    await expect(checkProxyAuth(authed)).resolves.toEqual({ ok: true })
  })

  it("rejects proxy in production when PROXY_ACCESS_TOKEN is unset", async () => {
    process.env.NODE_ENV = "production"
    const req = new Request("http://localhost/api/proxy/openai/v1/models")
    await expect(checkProxyAuth(req)).resolves.toEqual({
      ok: false,
      status: 503,
      message: "PROXY_ACCESS_TOKEN is not configured",
    })
  })

  it("maps known providers to upstream URLs", () => {
    expect(isKnownProxyProvider("openai")).toBe(true)
    expect(resolveProxyUpstreamUrl("deepseek", ["v1", "chat", "completions"])).toBe(
      "https://api.deepseek.com/v1/chat/completions"
    )
    expect(resolveProxyUpstreamUrl("tavily", ["search"])).toBe("https://api.tavily.com/search")
    expect(isKnownProxyProvider("unknown")).toBe(false)
  })

  it("rate limits by client IP", () => {
    process.env.PROXY_RATE_LIMIT_PER_MIN = "2"
    expect(checkRateLimit("1.2.3.4")).toEqual({ ok: true })
    expect(checkRateLimit("1.2.3.4")).toEqual({ ok: true })
    expect(checkRateLimit("1.2.3.4")).toEqual({ ok: false, status: 429, message: "Rate limit exceeded" })
    expect(checkRateLimit("5.6.7.8")).toEqual({ ok: true })
  })
})
