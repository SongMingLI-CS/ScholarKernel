import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), getState: vi.fn(), getJob: vi.fn(), after: vi.fn(), runIndex: vi.fn(),
}))

vi.mock("next/server", async (loadOriginal) => ({ ...(await loadOriginal<typeof import("next/server")>()), after: mocks.after }))
vi.mock("@/lib/auth-user", () => ({ resolveUserIdFromRequest: mocks.auth }))
vi.mock("@/lib/agent-jobs", () => ({
  getAgentJobStateForUser: mocks.getState,
  getAgentJobForUser: mocks.getJob,
  cancelAgentJob: vi.fn(),
}))
vi.mock("@/lib/agent/run-control", () => ({ cancelActiveAgentRun: vi.fn() }))
vi.mock("@/lib/library-index-job", () => ({ runLibraryIndexJob: mocks.runIndex }))

import { GET } from "../route"

describe("GET /api/agent/jobs/[id] index recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue("user-1")
  })

  it("schedules an expired Library index lease for atomic reclamation", async () => {
    mocks.getState.mockResolvedValue({
      id: "job-1", userId: "user-1", status: "running",
      leaseExpiresAt: new Date(Date.now() - 1_000),
      provider: { kind: "library-index", documentId: "doc-1" },
      nodes: [],
    })
    const response = await GET(new Request("http://localhost/api/agent/jobs/job-1"), { params: Promise.resolve({ id: "job-1" }) })
    expect(response.status).toBe(200)
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function))
    await mocks.after.mock.calls[0]![0]()
    expect(mocks.runIndex).toHaveBeenCalledWith("job-1", "user-1", "doc-1")
  })

  it("does not restart a healthy lease or an ordinary failed job", async () => {
    mocks.getState
      .mockResolvedValueOnce({ id: "job-1", status: "running", leaseExpiresAt: new Date(Date.now() + 60_000), provider: { kind: "library-index", documentId: "doc-1" }, nodes: [] })
      .mockResolvedValueOnce({ id: "job-2", status: "error", errorMessage: "ParserRejected", provider: { kind: "library-index", documentId: "doc-2" }, nodes: [] })
    await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "job-1" }) })
    await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "job-2" }) })
    expect(mocks.after).not.toHaveBeenCalled()
  })
})
