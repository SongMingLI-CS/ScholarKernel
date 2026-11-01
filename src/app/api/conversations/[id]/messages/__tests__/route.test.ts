import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE, POST } from "../route"

const { findFirst, findUnique, create, upsert, update, deleteMany, transaction } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
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
      findUnique,
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

  /**
   * IDOR：`where: { id: messageId }` 只按主键定位，没有任何租户约束。
   * 攻击者只要拥有**任意**一个会话，就能把别人的 message id 当 body.id 传进来，
   * upsert 的 update 分支会改写那条消息的 role/content —— 越权写。
   * 校验会话归属（`conversationOwnerWhere`）拦不住它：被攻击的消息不在这个会话里。
   */
  it("POST 拒绝覆盖其它会话的消息 id（跨租户 IDOR）", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    findUnique.mockResolvedValueOnce({ conversationId: "conv-victim" })

    const req = new Request("http://localhost/api/conversations/conv-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "msg-victim", role: "user", content: "attacker payload" }),
    })
    const res = await POST(req, ctx)

    expect(res.status).toBe(409)
    expect(upsert).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it("POST 允许覆盖本会话内的同一条消息（恢复备份的 upsert 语义）", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    findUnique.mockResolvedValueOnce({ conversationId: "conv-1" })
    upsert.mockResolvedValueOnce({ id: "m1", role: "user", content: "edited" })
    update.mockResolvedValueOnce({ id: "conv-1" })

    const req = new Request("http://localhost/api/conversations/conv-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "m1", role: "user", content: "edited" }),
    })
    const res = await POST(req, ctx)

    expect(res.status).toBe(201)
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it("POST 对全新 id 直接走 upsert 的 create 分支（不做多余拒绝）", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    findUnique.mockResolvedValueOnce(null)
    upsert.mockResolvedValueOnce({ id: "m-new", role: "user", content: "fresh" })
    update.mockResolvedValueOnce({ id: "conv-1" })

    const req = new Request("http://localhost/api/conversations/conv-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "m-new", role: "user", content: "fresh" }),
    })
    const res = await POST(req, ctx)

    expect(res.status).toBe(201)
  })
})
