import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  resolveUserIdFromRequest: vi.fn(),
  runAgentOnServer: vi.fn(),
  createAgentJob: vi.fn(),
  markAgentJobRunning: vi.fn(),
  completeAgentJob: vi.fn(),
  failAgentJob: vi.fn(),
  cancelAgentJob: vi.fn(),
  updateAgentJobCheckpoint: vi.fn(),
  updateAgentJobPeerReviewCheckpoint: vi.fn(),
  updateAgentJobWorkflowTopology: vi.fn(),
  assertQuotaAvailable: vi.fn(),
  events: [] as string[],
}))

vi.mock("@/lib/auth-user", () => ({ resolveUserIdFromRequest: mocks.resolveUserIdFromRequest }))
vi.mock("@/lib/agent-server-run", () => ({ runAgentOnServer: mocks.runAgentOnServer }))
vi.mock("@/lib/server-runtime-keys", () => ({
  loadRuntimeKeysForUser: vi.fn(async () => ({ openai: "server-key" })),
}))
vi.mock("@/lib/agent-jobs", () => ({
  createAgentJob: mocks.createAgentJob,
  markAgentJobRunning: mocks.markAgentJobRunning,
  completeAgentJob: mocks.completeAgentJob,
  failAgentJob: mocks.failAgentJob,
  cancelAgentJob: mocks.cancelAgentJob,
  updateAgentJobCheckpoint: mocks.updateAgentJobCheckpoint,
  updateAgentJobPeerReviewCheckpoint: mocks.updateAgentJobPeerReviewCheckpoint,
  updateAgentJobWorkflowTopology: mocks.updateAgentJobWorkflowTopology,
}))
vi.mock("@/lib/billing/quota-gate", () => ({
  assertQuotaAvailable: mocks.assertQuotaAvailable,
  jsonQuotaExceeded: vi.fn(),
  QuotaExceededError: class QuotaExceededError extends Error {},
}))

import { POST } from "../route"

function request(body: unknown) {
  return new Request("http://localhost/api/agent/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/agent/jobs checkpoint semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.events.length = 0
    mocks.resolveUserIdFromRequest.mockResolvedValue("user-1")
    mocks.createAgentJob.mockResolvedValue({ id: "job-1", checkpoint: null })
    mocks.markAgentJobRunning.mockResolvedValue({})
    mocks.updateAgentJobCheckpoint.mockImplementation(async () => {
      mocks.events.push("checkpoint")
    })
    mocks.updateAgentJobPeerReviewCheckpoint.mockImplementation(async () => {
      mocks.events.push("peer-review")
    })
    mocks.updateAgentJobWorkflowTopology.mockImplementation(async () => {
      mocks.events.push("topology")
    })
    mocks.completeAgentJob.mockImplementation(async () => {
      mocks.events.push("complete")
      return { status: "done" }
    })
    mocks.failAgentJob.mockResolvedValue({ status: "error" })
    mocks.cancelAgentJob.mockImplementation(async () => {
      mocks.events.push("cancel")
      return { status: "cancelled" }
    })
    mocks.runAgentOnServer.mockImplementation(async (_input, hooks) => {
      hooks?.onWorkflowPlanned?.([
        { id: "n1", type: "reasoning", provider: "cloud", status: "pending", logs: [] },
      ])
      hooks?.onNodePatch?.("n1", { status: "running" })
      return { final: "ok", nodes: [], sources: [] }
    })
  })

  it("waits for every queued checkpoint before marking the job done", async () => {
    const response = await POST(request({
      userInput: "hello",
      provider: { providerId: "openai", model: "gpt-5" },
    }))

    expect(response.status).toBe(200)
    expect(mocks.events.at(-1)).toBe("complete")
    expect(mocks.events.filter((event) => event === "checkpoint")).toHaveLength(2)
  })

  it("waits for checkpoints and marks cancellation instead of failure", async () => {
    mocks.runAgentOnServer.mockRejectedValueOnce(new DOMException("aborted", "AbortError"))

    const response = await POST(request({
      userInput: "cancel me",
      provider: { providerId: "openai", model: "gpt-5" },
    }))

    expect(response.status).toBe(499)
    expect(mocks.cancelAgentJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ phase: "running" }))
    expect(mocks.failAgentJob).not.toHaveBeenCalled()
  })
})
