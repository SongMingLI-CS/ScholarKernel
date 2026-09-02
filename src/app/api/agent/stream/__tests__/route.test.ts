import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveUserIdFromRequest: vi.fn(),
  loadRuntimeKeysForUser: vi.fn(),
  runAgentOnServer: vi.fn(),
  createAgentJob: vi.fn(),
  markAgentJobRunning: vi.fn(),
  completeAgentJob: vi.fn(),
  failAgentJob: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({ resolveUserIdFromRequest: mocks.resolveUserIdFromRequest }))
vi.mock("@/lib/server-runtime-keys", () => ({ loadRuntimeKeysForUser: mocks.loadRuntimeKeysForUser }))
vi.mock("@/lib/agent-server-run", () => ({ runAgentOnServer: mocks.runAgentOnServer }))
vi.mock("@/lib/agent-jobs", () => ({
  createAgentJob: mocks.createAgentJob,
  markAgentJobRunning: mocks.markAgentJobRunning,
  completeAgentJob: mocks.completeAgentJob,
  failAgentJob: mocks.failAgentJob,
}))
vi.mock("@/lib/billing/quota-gate", () => ({
  assertQuotaAvailable: vi.fn(),
  jsonQuotaExceeded: vi.fn(),
  QuotaExceededError: class QuotaExceededError extends Error {},
}))

import { POST } from "../route"
import { createAgentSseParser } from "@/lib/agent-stream-protocol"

function request(body: unknown) {
  return new Request("http://localhost/api/agent/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/agent/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveUserIdFromRequest.mockResolvedValue("user-1")
    mocks.loadRuntimeKeysForUser.mockResolvedValue({ deepseek: "server-secret" })
    mocks.createAgentJob.mockResolvedValue({ id: "job-1" })
    mocks.markAgentJobRunning.mockResolvedValue({})
    mocks.completeAgentJob.mockResolvedValue({})
    mocks.failAgentJob.mockResolvedValue({})
    mocks.runAgentOnServer.mockImplementation(async (_input, hooks) => {
      hooks?.onWorkflowPlanned?.([{ id: "n1", type: "reasoning", provider: "cloud", status: "pending" }])
      hooks?.onNodeLog?.("n1", "started")
      hooks?.onNodePatch?.("n1", { status: "running", output: { finalResponse: "hello" } })
      hooks?.onUsage?.({ model: "deepseek-chat", inputTokens: 5, outputTokens: 2 })
      hooks?.onResearchResultsSynced?.({
        nodeId: "n1",
        sources: [{ title: "Paper", url: "https://example.com" }],
        citationsMarkdown: "",
      })
      return { final: "hello", nodes: [], sources: [] }
    })
  })

  it("streams server-side Agent events without accepting browser secrets", async () => {
    const res = await POST(request({
      runId: "run-1",
      userInput: "hello",
      provider: { providerId: "deepseek_openai_compat", model: "deepseek-chat" },
      chatHistory: [],
      documentIds: ["doc-1"],
    }))

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const raw = await res.text()
    const parser = createAgentSseParser()
    const events = [...parser.push(raw), ...parser.finish()]
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["hello", "plan", "log", "node", "token", "source", "usage", "done"])
    )
    expect(mocks.runAgentOnServer).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        jobId: "job-1",
        runtimeKeys: { deepseek: "server-secret" },
        documentIds: ["doc-1"],
      }),
      expect.any(Object)
    )
    expect(raw).not.toContain("server-secret")
  })

  it("rejects runtime keys sent by the browser", async () => {
    const res = await POST(request({
      userInput: "hello",
      provider: { providerId: "openai", model: "gpt-5" },
      runtimeKeys: { openai: "browser-secret" },
    }))
    expect(res.status).toBe(400)
    expect(mocks.runAgentOnServer).not.toHaveBeenCalled()
  })

  it("requires authentication", async () => {
    mocks.resolveUserIdFromRequest.mockResolvedValue(null)
    const res = await POST(request({
      userInput: "hello",
      provider: { providerId: "openai", model: "gpt-5" },
    }))
    expect(res.status).toBe(401)
  })
})
