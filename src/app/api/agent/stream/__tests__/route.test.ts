import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveUserIdFromRequest: vi.fn(),
  loadRuntimeKeysForUser: vi.fn(),
  runAgentOnServer: vi.fn(),
  createAgentJob: vi.fn(),
  getAgentJobForUser: vi.fn(),
  markAgentJobRunning: vi.fn(),
  claimAgentJobRun: vi.fn(),
  withAgentJobHeartbeat: vi.fn(async (_id: string, operation: () => Promise<unknown>) => operation()),
  completeAgentJob: vi.fn(),
  failAgentJob: vi.fn(),
  cancelAgentJob: vi.fn(),
  updateAgentJobCheckpoint: vi.fn(),
  updateAgentJobPeerReviewCheckpoint: vi.fn(),
  updateAgentJobWorkflowTopology: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({ resolveUserIdFromRequest: mocks.resolveUserIdFromRequest }))
vi.mock("@/lib/server-runtime-keys", () => ({ loadRuntimeKeysForUser: mocks.loadRuntimeKeysForUser }))
vi.mock("@/lib/agent-server-run", () => ({ runAgentOnServer: mocks.runAgentOnServer }))
vi.mock("@/lib/agent-jobs", () => ({
  createAgentJob: mocks.createAgentJob,
  getAgentJobForUser: mocks.getAgentJobForUser,
  markAgentJobRunning: mocks.markAgentJobRunning,
  claimAgentJobRun: mocks.claimAgentJobRun,
  withAgentJobHeartbeat: mocks.withAgentJobHeartbeat,
  completeAgentJob: mocks.completeAgentJob,
  failAgentJob: mocks.failAgentJob,
  cancelAgentJob: mocks.cancelAgentJob,
  updateAgentJobCheckpoint: mocks.updateAgentJobCheckpoint,
  updateAgentJobPeerReviewCheckpoint: mocks.updateAgentJobPeerReviewCheckpoint,
  updateAgentJobWorkflowTopology: mocks.updateAgentJobWorkflowTopology,
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
    mocks.claimAgentJobRun.mockResolvedValue(true)
    mocks.completeAgentJob.mockResolvedValue({})
    mocks.failAgentJob.mockResolvedValue({})
    mocks.cancelAgentJob.mockResolvedValue({})
    mocks.updateAgentJobCheckpoint.mockResolvedValue({})
    mocks.updateAgentJobPeerReviewCheckpoint.mockResolvedValue({})
    mocks.updateAgentJobWorkflowTopology.mockResolvedValue({})
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
      hooks?.onEvidenceStatus?.([
        {
          id: "library:doc-1",
          kind: "library",
          label: "Paper",
          state: "loaded",
          detail: "upstream api_key=sk-supersecret123 failed",
          sourceCount: 2,
        },
      ])
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
      expect.arrayContaining(["hello", "plan", "log", "node", "token", "source", "evidence", "usage", "done"])
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
    expect(raw).not.toContain("sk-supersecret123")
    expect(raw).toContain("[redacted]")
    expect(mocks.updateAgentJobCheckpoint).toHaveBeenCalled()
    expect(mocks.completeAgentJob).toHaveBeenCalledAfter(mocks.updateAgentJobCheckpoint)
    expect(mocks.withAgentJobHeartbeat).toHaveBeenCalled()
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

  it("marks a cancelled job without losing its latest checkpoint", async () => {
    mocks.runAgentOnServer.mockRejectedValueOnce(new DOMException("The operation was aborted", "AbortError"))

    const res = await POST(request({
      userInput: "cancel me",
      provider: { providerId: "openai", model: "gpt-5" },
    }))
    const raw = await res.text()

    expect(raw).toContain('"code":"Aborted"')
    expect(mocks.cancelAgentJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ phase: "running" }))
    expect(mocks.failAgentJob).not.toHaveBeenCalled()
  })

  it("keeps the database job running when only the SSE transport disconnects", async () => {
    let release!: (value: { final: string; nodes: []; sources: [] }) => void
    mocks.runAgentOnServer.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const res = await POST(request({
      userInput: "long task",
      provider: { providerId: "openai", model: "gpt-5" },
    }))
    const reader = res.body!.getReader()
    await reader.read()
    await reader.cancel()
    release({ final: "completed after disconnect", nodes: [], sources: [] })
    await vi.waitFor(() => expect(mocks.completeAgentJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ final: "completed after disconnect" })))
    expect(mocks.cancelAgentJob).not.toHaveBeenCalled()
  })

  it("replays a completed database result without re-executing the job", async () => {
    mocks.getAgentJobForUser.mockResolvedValueOnce({
      id: "job-done", status: "done", checkpoint: { phase: "done" },
      result: { final: "persisted final", nodes: [{ id: "n1", type: "reasoning", provider: "cloud", status: "done", dependsOn: [] }], sources: [] },
    })
    const res = await POST(request({
      jobId: "job-done", userInput: "resume", provider: { providerId: "openai", model: "gpt-5" },
    }))
    const events = createAgentSseParser().push(await res.text())
    expect(events.map((event) => event.type)).toEqual(["hello", "plan", "done"])
    expect(events.at(-1)).toMatchObject({ type: "done", final: "persisted final" })
    expect(mocks.runAgentOnServer).not.toHaveBeenCalled()
  })

  it("reconnects to a running database job without starting duplicate execution", async () => {
    const running = {
      id: "job-running", status: "running", result: null,
      checkpoint: { phase: "running", nodes: [{ id: "n1", type: "reasoning", provider: "cloud", status: "running", dependsOn: [] }] },
    }
    const done = {
      ...running, status: "done",
      result: { final: "persisted after reconnect", nodes: [{ id: "n1", type: "reasoning", provider: "cloud", status: "done", dependsOn: [] }], sources: [] },
    }
    mocks.getAgentJobForUser.mockResolvedValueOnce(running).mockResolvedValueOnce(done)
    const res = await POST(request({
      jobId: "job-running", userInput: "resume", provider: { providerId: "openai", model: "gpt-5" },
    }))
    const events = createAgentSseParser().push(await res.text())
    expect(events.map((event) => event.type)).toEqual(["hello", "plan", "plan", "done"])
    expect(events.at(-1)).toMatchObject({ type: "done", final: "persisted after reconnect" })
    expect(mocks.runAgentOnServer).not.toHaveBeenCalled()
  })
})
