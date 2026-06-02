import { beforeEach, describe, expect, it, vi } from "vitest"

import { PATCH } from "../route"

const { findFirst, update } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
  conversationOwnerWhere: (userId: string) => ({ userId }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst },
    document: { findFirst, update },
  },
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

const ctx = { params: Promise.resolve({ id: "conv-1", docId: "doc-1" }) }

describe("PATCH /api/conversations/[id]/documents/[docId]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
  })

  it("returns 400 for empty patch body", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    const req = new Request("http://localhost/api/conversations/conv-1/documents/doc-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(400)
  })

  it("returns 404 when document missing", async () => {
    findFirst
      .mockResolvedValueOnce({ id: "conv-1" })
      .mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/conversations/conv-1/documents/doc-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "updated" }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(404)
  })

  it("updates document content and bumps version", async () => {
    findFirst
      .mockResolvedValueOnce({ id: "conv-1" })
      .mockResolvedValueOnce({ id: "doc-1", conversationId: "conv-1", version: 2 })
    update.mockResolvedValueOnce({
      id: "doc-1",
      conversationId: "conv-1",
      title: "综述",
      content: "updated",
      version: 3,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    })
    const req = new Request("http://localhost/api/conversations/conv-1/documents/doc-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "updated" }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { content: string; version: number }
    expect(body.content).toBe("updated")
    expect(body.version).toBe(3)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "updated", version: 3 }),
      })
    )
  })
})
