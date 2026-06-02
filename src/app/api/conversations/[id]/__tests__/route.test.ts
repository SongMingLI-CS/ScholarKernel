import { beforeEach, describe, expect, it, vi } from "vitest"

import { DELETE, PATCH } from "../route"

const { findFirst, update, deleteFn } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  deleteFn: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: async () => "user-test",
  conversationOwnerWhere: (userId: string) => ({ userId }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findFirst,
      update,
      delete: deleteFn,
    },
  },
}))

const ctx = { params: Promise.resolve({ id: "conv-1" }) }

describe("PATCH /api/conversations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 400 when body has no patchable fields", async () => {
    const req = new Request("http://localhost/api/conversations/conv-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(400)
  })

  it("returns 404 when conversation is not owned", async () => {
    findFirst.mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/conversations/conv-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "新标题" }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(404)
  })

  it("renames conversation and returns summary", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    update.mockResolvedValueOnce({
      id: "conv-1",
      title: "新标题",
      isPinned: false,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    })
    const req = new Request("http://localhost/api/conversations/conv-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "  新标题  " }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { title: string }
    expect(json.title).toBe("新标题")
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1" },
        data: { title: "新标题" },
      })
    )
  })
})

describe("DELETE /api/conversations/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 404 when conversation is not owned", async () => {
    findFirst.mockResolvedValueOnce(null)
    const res = await DELETE(new Request("http://localhost"), ctx)
    expect(res.status).toBe(404)
  })

  it("deletes conversation with 204", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    deleteFn.mockResolvedValueOnce({ id: "conv-1" })
    const res = await DELETE(new Request("http://localhost"), ctx)
    expect(res.status).toBe(204)
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: "conv-1" } })
  })
})
