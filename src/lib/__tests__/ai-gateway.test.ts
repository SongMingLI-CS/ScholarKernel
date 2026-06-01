import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  GatewayAuthError,
  GatewayMissingKeyError,
  testConnection,
  validateProvider,
} from "@/lib/ai-gateway"

describe("ai-gateway", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("GatewayAuthError exposes status and detail", () => {
    const err = new GatewayAuthError(401, "bad key")
    expect(err.code).toBe("InvalidApiKey")
    expect(err.status).toBe(401)
    expect(err.detail).toBe("bad key")
  })

  it("GatewayMissingKeyError uses MissingApiKey code", () => {
    const err = new GatewayMissingKeyError()
    expect(err.code).toBe("MissingApiKey")
  })

  it("validateProvider returns missing_key without api key for openai", async () => {
    const result = await validateProvider("openai", "gpt-4o-mini")
    expect(result.ok).toBe(false)
    expect(result.kind).toBe("missing_key")
  })

  it("validateProvider succeeds for openai when upstream returns 200", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "cmpl" }), { status: 200 }))
    const result = await validateProvider("openai", "gpt-4o-mini", {
      apiKey: "sk-test-key-1234567890",
      baseUrl: "https://api.openai.com/v1",
    })
    expect(result.ok).toBe(true)
    expect(result.kind).toBe("ok")
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("validateProvider maps 401 to unauthorized", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "invalid key" } }), { status: 401 })
    )
    const result = await validateProvider("deepseek_openai_compat", "deepseek-chat", {
      apiKey: "sk-test-key-1234567890",
      baseUrl: "https://api.deepseek.com/v1",
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe("unauthorized")
    expect(result.status).toBe(401)
  })

  it("validateProvider probes ollama chat endpoint", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: "pong" } }), { status: 200 }))
    const result = await validateProvider("ollama", "llama3.2", {
      baseUrl: "http://localhost:11434",
    })
    expect(result.ok).toBe(true)
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:11434/api/chat")
  })

  it("validateProvider classifies network failures as cors/unknown", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    const result = await validateProvider("openai", "gpt-4o-mini", {
      apiKey: "sk-test-key-1234567890",
      baseUrl: "https://api.openai.com/v1",
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe("cors")
  })

  it("testConnection maps validateProvider unauthorized to InvalidApiKey", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: "invalid" } }), { status: 403 })
    )
    const result = await testConnection("anthropic", "claude-3-5-sonnet-20241022", {
      apiKey: "sk-ant-test-key-1234567890",
      baseUrl: "https://api.anthropic.com",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("InvalidApiKey")
  })
})
