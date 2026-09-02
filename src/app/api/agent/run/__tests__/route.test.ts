import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "../route"

const { runAgentOnServer } = vi.hoisted(() => ({
  runAgentOnServer: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
}))

vi.mock("@/lib/agent-server-run", () => ({
  runAgentOnServer,
}))

vi.mock("@/lib/server-runtime-keys", () => ({
  loadRuntimeKeysForUser: vi.fn(async () => ({ openai: "server-key" })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userBilling: {
      upsert: vi.fn(async ({ where, create }: { where: { userId: string }; create: { userId: string; tokenQuota: number } }) => ({
        userId: where.userId,
        tokenUsed: 0,
        tokenQuota: create.tokenQuota,
        totalSpent: 0,
        updatedAt: new Date(),
      })),
    },
  },
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

describe("POST /api/agent/run", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUserIdFromRequest).mockResolvedValueOnce(null)
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
    expect(runAgentOnServer).toHaveBeenCalledWith(expect.objectContaining({
      runtimeKeys: { openai: "server-key" },
    }))
  })

  it("rejects browser-supplied provider credentials", async () => {
    const res = await POST(
      new Request("http://localhost/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userInput: "hello",
          provider: { providerId: "openai", model: "gpt-4o" },
          runtimeKeys: { openai: "browser-secret" },
        }),
      })
    )
    expect(res.status).toBe(400)
    expect(runAgentOnServer).not.toHaveBeenCalled()
  })
})
