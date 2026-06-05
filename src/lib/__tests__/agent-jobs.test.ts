import { beforeEach, describe, expect, it, vi } from "vitest"

const { create, findFirst, update } = vi.hoisted(() => ({
  create: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentJob: { create, findFirst, update },
  },
}))

import {
  completeAgentJob,
  createAgentJob,
  failAgentJob,
  getAgentJobForUser,
  markAgentJobRunning,
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
})
