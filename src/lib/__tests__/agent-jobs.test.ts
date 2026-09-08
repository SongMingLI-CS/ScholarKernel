import { beforeEach, describe, expect, it, vi } from "vitest"

const { create, findFirst, findUnique, update, updateMany } = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentJob: { create, findFirst, findUnique, update, updateMany },
  },
}))

import {
  cancelAgentJob,
  claimAgentJobRun,
  completeAgentJob,
  createAgentJob,
  failAgentJob,
  getAgentJobForUser,
  markAgentJobRunning,
  refreshAgentJobHeartbeat,
  withAgentJobHeartbeat,
  updateAgentJobCheckpoint,
} from "@/lib/agent-jobs"

describe("agent-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("createAgentJob stores pending job", async () => {
    create.mockResolvedValueOnce({ id: "j1", status: "pending", input: "hi" })
    const job = await createAgentJob("u1", { userInput: "hi", provider: { providerId: "ollama", model: "m" } })
    expect(job.id).toBe("j1")
    expect(create).toHaveBeenCalled()
  })

  it("updateAgentJobCheckpoint merges checkpoint", async () => {
    update.mockResolvedValueOnce({ id: "j1", checkpoint: { phase: "running" } })
    await updateAgentJobCheckpoint("j1", { phase: "running", nodes: [] })
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j1" },
        data: expect.objectContaining({ checkpoint: expect.any(Object) }),
      })
    )
  })

  it("getAgentJobForUser scopes by userId", async () => {
    findFirst.mockResolvedValueOnce({ id: "j1", userId: "u1" })
    const job = await getAgentJobForUser("j1", "u1")
    expect(job?.id).toBe("j1")
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "j1", userId: "u1" } })
  })

  it("completeAgentJob sets done status", async () => {
    update.mockResolvedValueOnce({ id: "j1", status: "done" })
    const job = await completeAgentJob("j1", { final: "ok", nodes: [], sources: [] })
    expect(job.status).toBe("done")
  })

  it("failAgentJob stores error message and stack", async () => {
    const err = new Error("boom")
    err.stack = "Error: boom\n    at x.ts:1:1"
    update.mockResolvedValueOnce({
      id: "j1",
      status: "error",
      error: "boom",
      errorMessage: "boom",
      errorStack: "Error: boom\n    at x.ts:1:1",
    })
    const job = await failAgentJob("j1", err)
    expect(job.errorMessage).toBe("boom")
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "error",
          errorMessage: "boom",
          errorStack: expect.stringContaining("boom"),
        }),
      })
    )
  })

  it("markAgentJobRunning sets running", async () => {
    update.mockResolvedValueOnce({ id: "j1", status: "running" })
    const job = await markAgentJobRunning("j1")
    expect(job.status).toBe("running")
  })

  it("cancelAgentJob records a distinct cancelled terminal state", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 })
    findUnique.mockResolvedValueOnce({ id: "j1", status: "cancelled" })
    const job = await cancelAgentJob("j1", { phase: "running", nodes: [{ id: "n1" }] })
    expect(job?.status).toBe("cancelled")
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "j1", status: { in: ["pending", "running"] } },
      data: expect.objectContaining({
        status: "cancelled",
        checkpoint: { phase: "cancelled", nodes: [{ id: "n1" }] },
        error: null,
        errorMessage: null,
        errorStack: null,
        leaseExpiresAt: null,
      }),
    })
  })

  it("does not overwrite a completed terminal state with a late cancellation", async () => {
    updateMany.mockResolvedValueOnce({ count: 0 })
    findUnique.mockResolvedValueOnce({ id: "j1", status: "done" })
    const job = await cancelAgentJob("j1", { phase: "running" })
    expect(job?.status).toBe("done")
    expect(update).not.toHaveBeenCalled()
  })

  it("claims a pending job exactly once with a conditional database update", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    await expect(claimAgentJobRun("j1")).resolves.toBe(true)
    await expect(claimAgentJobRun("j1")).resolves.toBe(false)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "j1", status: { in: ["pending", "error"] } },
      data: expect.objectContaining({ status: "running", heartbeatAt: expect.any(Date), leaseExpiresAt: expect.any(Date) }),
    }))
  })

  it("renews a running job lease while long work is in progress", async () => {
    vi.useFakeTimers()
    updateMany.mockResolvedValue({ count: 1 })
    let finish!: () => void
    const operation = new Promise<void>((resolve) => { finish = resolve })
    const run = withAgentJobHeartbeat("j1", () => operation, { intervalMs: 1_000, leaseMs: 5_000 })
    await vi.advanceTimersByTimeAsync(2_100)
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "j1", status: "running" },
    }))
    finish()
    await run
    vi.useRealTimers()
  })

  it("refreshes only a running job", async () => {
    updateMany.mockResolvedValueOnce({ count: 1 })
    await expect(refreshAgentJobHeartbeat("j1", 12_000)).resolves.toBe(true)
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "j1", status: "running" },
      data: expect.objectContaining({ heartbeatAt: expect.any(Date), leaseExpiresAt: expect.any(Date) }),
    }))
  })
})
