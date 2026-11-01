import { beforeEach, describe, expect, it, vi } from "vitest"

const { create, findFirst, findUnique, update } = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentJob: { create, findFirst, findUnique, update },
  },
}))

import {
  completeAgentJob,
  createAgentJob,
  failAgentJob,
  getAgentJobForUser,
  markAgentJobRunning,
  persistAgentJobError,
  updateAgentJobCheckpoint,
} from "@/lib/agent-jobs"

const PRIOR_CHECKPOINT = {
  phase: "running",
  nodes: [{ id: "n1" }],
  peerReview: {
    version: 1,
    subject: "Abstract",
    methodologyReview: "R1 already paid for",
    completedStages: ["r1"],
  },
}

function lastUpdateData(): Record<string, unknown> {
  const call = update.mock.calls[update.mock.calls.length - 1]?.[0] as
    | { data?: Record<string, unknown> }
    | undefined
  return call?.data ?? {}
}

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
})

describe("agent-jobs 错误路径不得抹掉已完成的阶段快照", () => {
  it("failAgentJob 合并而不是整体替换 checkpoint", async () => {
    findUnique.mockResolvedValueOnce({ checkpoint: PRIOR_CHECKPOINT })
    update.mockResolvedValueOnce({ id: "j1", status: "error" })

    await failAgentJob("j1", new Error("boom"), { phase: "error" })

    const checkpoint = lastUpdateData().checkpoint as Record<string, unknown>
    expect(checkpoint.phase).toBe("error")
    // 已经跑完并付费的 reviewer 文本必须留下，否则断点续跑会重新扣费
    expect((checkpoint.peerReview as Record<string, unknown>).methodologyReview).toBe("R1 already paid for")
    expect(checkpoint.nodes).toEqual([{ id: "n1" }])
  })

  it("failAgentJob 在读取历史 checkpoint 失败时仍然写入错误", async () => {
    findUnique.mockRejectedValueOnce(new Error("db down"))
    update.mockResolvedValueOnce({ id: "j1", status: "error" })

    const job = await failAgentJob("j1", new Error("boom"), { phase: "error" })
    expect(job.status).toBe("error")
    expect(lastUpdateData().status).toBe("error")
  })

  it("persistAgentJobError 按 jobId 写入时保留 peerReview 快照", async () => {
    findFirst.mockResolvedValueOnce({ id: "j1", userId: "u1", checkpoint: PRIOR_CHECKPOINT })
    update.mockResolvedValueOnce({ id: "j1", status: "error" })

    await persistAgentJobError("u1", new Error("boom"), { jobId: "j1" })

    const checkpoint = lastUpdateData().checkpoint as Record<string, unknown>
    expect((checkpoint.peerReview as Record<string, unknown>).methodologyReview).toBe("R1 already paid for")
    expect(checkpoint.phase).toBe("error")
  })

  it("persistAgentJobError 兜底到活跃任务时同样保留 peerReview 快照", async () => {
    findFirst.mockResolvedValueOnce({ id: "j2", checkpoint: PRIOR_CHECKPOINT })
    update.mockResolvedValueOnce({ id: "j2", status: "error" })

    await persistAgentJobError("u1", new Error("boom"))

    const checkpoint = lastUpdateData().checkpoint as Record<string, unknown>
    expect((checkpoint.peerReview as Record<string, unknown>).methodologyReview).toBe("R1 already paid for")
  })
})
