import { beforeEach, describe, expect, it, vi } from "vitest"

const { findFirst, findUnique, update } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: { agentJob: { create: vi.fn(), findFirst, findUnique, update } },
}))

import { failAgentJob, persistAgentJobError } from "@/lib/agent-jobs"

/**
 * 终态不可逆：`done` 的任务不该被「事后错误」改写成 `error`。
 *
 * 现实触发路径：`/api/agent/run` 里 `void persistAgentJobError(...)` 是 **fire-and-forget**，
 * 它和 `completeAgentJob` 没有顺序保证 —— 一次已经成功完成、甚至已经拿到结果的运行，
 * 只要在之后的收尾（写消息、断流、客户端 abort）里抛错，就会被标成失败：
 *
 *   status = "error"          ← 用户看到「失败」
 *   result = {...}            ← 结果其实在
 *   checkpoint.phase = "error" ← 与 result 自相矛盾
 *
 * 这个记录之后既不能被断点续跑（phase 已 error）、也不能被信任（结果在但状态是失败）。
 */

const DONE_JOB = {
  id: "j1",
  userId: "u1",
  status: "done",
  result: { final: "answer", nodes: [], sources: [] },
  checkpoint: { phase: "done", nodes: [] },
}

describe("终态保护：failAgentJob", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("已完成的任务不会被改写成 error", async () => {
    findUnique.mockResolvedValueOnce(DONE_JOB)

    const job = await failAgentJob("j1", new Error("post-run cleanup failed"))

    expect(update).not.toHaveBeenCalled()
    expect(job.status).toBe("done")
    expect(job.result).toEqual(DONE_JOB.result)
  })

  it("运行中的任务仍然被标记为 error（回归）", async () => {
    findUnique.mockResolvedValueOnce({ id: "j2", status: "running", checkpoint: { phase: "running" } })
    update.mockResolvedValueOnce({ id: "j2", status: "error" })

    const job = await failAgentJob("j2", new Error("boom"), { phase: "error" })

    expect(job.status).toBe("error")
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j2" },
        data: expect.objectContaining({ status: "error" }),
      })
    )
  })
})

describe("终态保护：persistAgentJobError（fire-and-forget 路径）", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("按 jobId 写入时跳过已完成的任务", async () => {
    findFirst.mockResolvedValueOnce(DONE_JOB)

    await persistAgentJobError("u1", new Error("late failure"), { jobId: "j1" })

    expect(update).not.toHaveBeenCalled()
  })

  it("跳过已完成任务后不会顺手把别的活跃任务标成失败", async () => {
    findFirst.mockResolvedValueOnce(DONE_JOB)

    await persistAgentJobError("u1", new Error("late failure"), { jobId: "j1" })

    // 只查过一次（按 jobId），不应再走「找最新活跃任务」的兜底查询
    expect(findFirst).toHaveBeenCalledTimes(1)
  })

  it("运行中的任务仍然写入错误（回归）", async () => {
    findFirst.mockResolvedValueOnce({ id: "j3", userId: "u1", status: "running", checkpoint: { phase: "running" } })
    update.mockResolvedValueOnce({ id: "j3", status: "error" })

    await persistAgentJobError("u1", new Error("boom"), { jobId: "j3" })

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j3" },
        data: expect.objectContaining({ status: "error" }),
      })
    )
  })
})
