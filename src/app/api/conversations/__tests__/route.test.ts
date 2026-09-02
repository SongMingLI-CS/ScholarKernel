import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET, POST } from "../route"

const { findMany, create, messageCreate } = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
  messageCreate: vi.fn(),
}))

const { createAgentJob, markAgentJobRunning, updateAgentJobCheckpoint } = vi.hoisted(() => ({
  createAgentJob: vi.fn(),
  markAgentJobRunning: vi.fn(),
  updateAgentJobCheckpoint: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
  conversationOwnerWhere: (userId: string) => ({ userId }),
}))

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}))

vi.mock("@/lib/agent-jobs", () => ({
  createAgentJob,
  markAgentJobRunning,
  updateAgentJobCheckpoint,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ id: "user-test" })),
      upsert: vi.fn(),
    },
    conversation: {
      findMany,
      create,
    },
    message: {
      create: messageCreate,
    },
  },
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

describe("/api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
  })

  it("GET returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUserIdFromRequest).mockResolvedValueOnce(null)
    const res = await GET(new Request("http://localhost/api/conversations"))
    expect(res.status).toBe(401)
  })

  it("GET lists conversations", async () => {
    findMany.mockResolvedValueOnce([{ id: "c1", title: "新对话", isPinned: false }])
    const res = await GET(new Request("http://localhost/api/conversations"))
    expect(res.status).toBe(200)
    const json = (await res.json()) as unknown[]
    expect(json).toHaveLength(1)
  })

  it("GET with limit returns paginated payload", async () => {
    findMany.mockResolvedValueOnce([
      { id: "c1", title: "A", isPinned: false, createdAt: new Date(), updatedAt: new Date() },
      { id: "c2", title: "B", isPinned: false, createdAt: new Date(), updatedAt: new Date() },
    ])
    const res = await GET(new Request("http://localhost/api/conversations?limit=1"))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: unknown[]; hasMore: boolean; nextCursor: string | null }
    expect(json.items).toHaveLength(1)
    expect(json.hasMore).toBe(true)
    expect(json.nextCursor).toBe("c1")
  })

  it("POST creates conversation", async () => {
    create.mockResolvedValueOnce({
      id: "c-new",
      title: "新对话",
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    const res = await POST(new Request("http://localhost/api/conversations", { method: "POST" }))
    expect(res.status).toBe(201)
    const json = (await res.json()) as { id: string }
    expect(json.id).toBe("c-new")
  })

  it("POST with templateId injects systemPrompt and running agent checkpoint", async () => {
    create.mockResolvedValueOnce({
      id: "c-template",
      title: "顶会双盲评审模拟器",
      isPinned: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    createAgentJob.mockResolvedValueOnce({ id: "job-1" })
    markAgentJobRunning.mockResolvedValueOnce({ id: "job-1", status: "running" })
    updateAgentJobCheckpoint.mockResolvedValueOnce({ id: "job-1" })
    messageCreate.mockResolvedValue({ id: "m1" })

    const res = await POST(
      new Request("http://localhost/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "neurips-peer-review" }),
      })
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as {
      templateBootstrap?: { systemPrompt: string; templateId: string; jobId: string }
    }
    expect(json.templateBootstrap?.templateId).toBe("neurips-peer-review")
    expect(json.templateBootstrap?.systemPrompt).toContain("NeurIPS")
    expect(json.templateBootstrap?.jobId).toBe("job-1")
    expect(createAgentJob).toHaveBeenCalled()
    expect(updateAgentJobCheckpoint).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ phase: "running", nodes: expect.any(Array) })
    )
  })

  it("POST returns 400 for unknown templateId", async () => {
    const res = await POST(
      new Request("http://localhost/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: "not-a-template" }),
      })
    )
    expect(res.status).toBe(400)
  })
})
