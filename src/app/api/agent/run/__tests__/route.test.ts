import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "../route"

const { runAgentOnServer } = vi.hoisted(() => ({
  runAgentOnServer: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(() => "user-test"),
}))

vi.mock("@/lib/agent-server-run", () => ({
  runAgentOnServer,
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

describe("POST /api/agent/run", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockReturnValue("user-test")
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUserIdFromRequest).mockReturnValueOnce(null)
    const res = await POST(
      new Request("http://localhost/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: "hi", provider: { providerId: "ollama", model: "m" } }),
      })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid body", async () => {
    const res = await POST(
      new Request("http://localhost/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput: "" }),
      })
    )
    expect(res.status).toBe(400)
  })

  it("returns agent result on success", async () => {
    runAgentOnServer.mockResolvedValueOnce({ final: "done", nodes: [], sources: [] })
    const res = await POST(
      new Request("http://localhost/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userInput: "explain attention",
          provider: { providerId: "ollama", model: "llama3.1", baseUrl: "http://localhost:11434" },
        }),
      })
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { final: string }
    expect(json.final).toBe("done")
  })
})
