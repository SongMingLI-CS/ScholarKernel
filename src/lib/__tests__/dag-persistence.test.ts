import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), update: vi.fn(), nodeUpdateMany: vi.fn(), jobUpdateMany: vi.fn(), documentUpdateMany: vi.fn(), transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}))

import { persistDagNodeStateAtomically, recoverExpiredDagLeases } from "@/lib/agent/dag-persistence"

describe("DAG transactional persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const tx = {
      agentJob: { findUnique: mocks.findUnique, findMany: mocks.findMany, update: mocks.update, updateMany: mocks.jobUpdateMany },
      agentNode: { upsert: mocks.upsert, updateMany: mocks.nodeUpdateMany },
      document: { updateMany: mocks.documentUpdateMany },
    }
    mocks.transaction.mockImplementation(async (fn) => fn(tx))
    mocks.findUnique.mockResolvedValue({ checkpoint: { phase: "running" } })
    mocks.upsert.mockResolvedValue({})
    mocks.update.mockResolvedValue({})
    mocks.nodeUpdateMany.mockResolvedValue({ count: 1 })
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 })
    mocks.documentUpdateMany.mockResolvedValue({ count: 1 })
    mocks.findMany.mockResolvedValue([{ id: "expired-index-job" }])
  })

  it("writes node status/output and job checkpoint inside one transaction", async () => {
    const node = { id: "n1", type: "reasoning" as const, provider: "cloud" as const, status: "pending" as const, dependsOn: [] }
    const state = {
      node, status: "done" as const, output: { text: "ok" }, attemptCount: 1,
      inputHash: "input", upstreamResultHash: "upstream", idempotencyKey: "idem", completedAt: new Date(),
    }
    await persistDagNodeStateAtomically("job-1", state, [state])
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ status: "done", outputs: { text: "ok" }, outputSnapshot: { text: "ok" }, inputHash: "input" }),
    }))
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ checkpoint: expect.objectContaining({ nodes: [expect.objectContaining({ id: "n1", status: "done", output: { text: "ok" } })] }) }),
    }))
  })

  it("moves expired RUNNING jobs and nodes to an explicit recovery state", async () => {
    expect(await recoverExpiredDagLeases(new Date("2026-09-08T00:00:00Z"))).toBe(1)
    expect(mocks.nodeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ errorCategory: "lease-expired" }) }))
    expect(mocks.jobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "error", errorMessage: "LeaseExpired" }) }))
    expect(mocks.documentUpdateMany).toHaveBeenCalledWith({
      where: { indexJobId: { in: ["expired-index-job"] }, indexStatus: "pending" },
      data: { indexStatus: "failed", indexError: "PostResponseIndexLeaseExpired" },
    })
  })
})
