import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE, POST } from "../route"

const { findFirst, create, upsert, update, deleteMany, transaction } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
  conversationOwnerWhere: (userId: string) => ({ userId }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findFirst,
      update,
    },
    message: {
      create,
      upsert,
      deleteMany,
    },
    $transaction: transaction,
  },
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

const ctx = { params: Promise.resolve({ id: "conv-1" }) }

describe("/api/conversations/[id]/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
    transaction.mockImplementation(async (ops: unknown[]) => {
      const results = []
      for (const op of ops) results.push(await op)
      return results
    })
  })

  it("POST returns 400 for invalid body", async () => {
    const req = new Request("http://localhost/api/conversations/conv-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user" }),
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(400)
  })

  it("POST returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUserIdFromRequest).mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/conversations/conv-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: "hi" }),
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(401)
  })

  it("POST returns 404 when conversation missing", async () => {
    findFirst.mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/conversations/conv-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: "hi" }),
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(404)
  })

  it("POST appends message", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    create.mockResolvedValueOnce({ id: "m1", role: "user", content: "hi" })
    update.mockResolvedValueOnce({ id: "conv-1" })
    const req = new Request("http://localhost/api/conversations/conv-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "user", content: "hi" }),
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(201)
  })

  it("DELETE clears messages with 204", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    deleteMany.mockResolvedValueOnce({ count: 2 })
    update.mockResolvedValueOnce({ id: "conv-1" })
    const res = await DELETE(new Request("http://localhost/api/conversations/conv-1/messages"), ctx)
    expect(res.status).toBe(204)
  })
})
