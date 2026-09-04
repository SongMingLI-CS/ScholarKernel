import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "../route"

const { loadRuntimeKeysForUser, validateProvider } = vi.hoisted(() => ({
  loadRuntimeKeysForUser: vi.fn(),
  validateProvider: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
}))

vi.mock("@/lib/server-runtime-keys", () => ({ loadRuntimeKeysForUser }))
vi.mock("@/lib/ai-gateway", () => ({ validateProvider }))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

describe("POST /api/providers/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
    loadRuntimeKeysForUser.mockResolvedValue({ openai: "stored-openai-key" })
    validateProvider.mockResolvedValue({ ok: true, latencyMs: 42, kind: "ok", status: 200 })
  })

  it("validates a cloud provider with the signed-in user's stored key", async () => {
    const res = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "openai", model: "gpt-4o", baseUrl: "https://api.openai.com/v1" }),
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, latencyMs: 42 })
    expect(loadRuntimeKeysForUser).toHaveBeenCalledWith("user-test")
    expect(validateProvider).toHaveBeenCalledWith("openai", "gpt-4o", {
      baseUrl: "https://api.openai.com/v1",
      apiKey: "stored-openai-key",
    })
  })

  it("converts a legacy browser proxy URL before server-side validation", async () => {
    loadRuntimeKeysForUser.mockResolvedValueOnce({ deepseek: "stored-deepseek-key" })
    await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providerId: "deepseek_openai_compat",
        model: "deepseek-chat",
        baseUrl: "/api/proxy/deepseek",
      }),
    }))

    expect(validateProvider).toHaveBeenCalledWith("deepseek_openai_compat", "deepseek-chat", {
      baseUrl: "https://api.deepseek.com",
      apiKey: "stored-deepseek-key",
    })
  })

  it("rejects browser-supplied credentials", async () => {
    const res = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "openai", model: "gpt-4o", apiKey: "browser-secret" }),
    }))

    expect(res.status).toBe(400)
    expect(validateProvider).not.toHaveBeenCalled()
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUserIdFromRequest).mockResolvedValueOnce(null)
    const res = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "openai", model: "gpt-4o" }),
    }))

    expect(res.status).toBe(401)
    expect(loadRuntimeKeysForUser).not.toHaveBeenCalled()
  })

  it("returns a missing-key result without calling the upstream provider", async () => {
    loadRuntimeKeysForUser.mockResolvedValueOnce({})
    const res = await POST(new Request("http://localhost/api/providers/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "anthropic", model: "claude-3-5-sonnet-latest" }),
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: false, kind: "missing_key", detail: "MissingApiKey" })
    expect(validateProvider).not.toHaveBeenCalled()
  })
})
