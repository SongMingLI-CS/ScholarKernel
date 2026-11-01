import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  RATE_LIMIT_BUCKET_MAX,
  checkProxyAuth,
  checkRateLimit,
  isKnownProxyProvider,
  proxyRateLimitBucketCountForTests,
  resolveProxyUpstreamUrl,
  resetProxyRateLimitsForTests,
} from "@/lib/proxy-gateway"

// NODE_ENV 在 @types/node 中是只读属性，测试里用显式断言写入
function setNodeEnv(value: string) {
  ;(process.env as Record<string, string | undefined>).NODE_ENV = value
}

describe("proxy-gateway", () => {
  const envSnapshot = { ...process.env }

  beforeEach(() => {
    resetProxyRateLimitsForTests()
    process.env = { ...envSnapshot }
    delete process.env.PROXY_ACCESS_TOKEN
    delete process.env.PROXY_RATE_LIMIT_PER_MIN
    setNodeEnv("development")
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

  it("allows proxy in production when PROXY_ACCESS_TOKEN is unset (direct fallback)", async () => {
    setNodeEnv("production")
    const req = new Request("http://localhost/api/proxy/openai/v1/models")
    await expect(checkProxyAuth(req)).resolves.toEqual({ ok: true })
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

  it("drops expired buckets instead of keeping every IP forever", () => {
    const t0 = 1_700_000_000_000
    for (let i = 0; i < 500; i++) checkRateLimit(`10.1.${Math.floor(i / 256)}.${i % 256}`, t0)
    expect(proxyRateLimitBucketCountForTests()).toBe(500)

    // 两分钟后所有窗口都已过期；请求一次即可触发清理
    checkRateLimit("10.9.9.9", t0 + 120_000)
    expect(proxyRateLimitBucketCountForTests()).toBe(1)
  })

  it("keeps the bucket map bounded even when every window is still live", () => {
    const t0 = 1_700_000_000_000
    for (let i = 0; i < RATE_LIMIT_BUCKET_MAX + 50; i++) {
      checkRateLimit(`172.16.${Math.floor(i / 256) % 256}.${i % 256}-${i}`, t0)
    }
    expect(proxyRateLimitBucketCountForTests()).toBeLessThanOrEqual(RATE_LIMIT_BUCKET_MAX)
  })
})
