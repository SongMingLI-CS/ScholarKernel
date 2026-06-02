import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "../route"

const { findFirst, create } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
  conversationOwnerWhere: (userId: string) => ({ userId }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { findFirst },
    document: { create },
  },
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

const ctx = { params: Promise.resolve({ id: "conv-1" }) }

describe("POST /api/conversations/[id]/documents", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUserIdFromRequest).mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/conversations/conv-1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "综述" }),
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(401)
  })

  it("returns 404 when conversation missing", async () => {
    findFirst.mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/conversations/conv-1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "综述", content: "# hi" }),
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(404)
  })

  it("creates document for owned conversation", async () => {
    findFirst.mockResolvedValueOnce({ id: "conv-1" })
    create.mockResolvedValueOnce({
      id: "doc-1",
      conversationId: "conv-1",
      title: "综述",
      content: "# hi",
      version: 1,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    })
    const req = new Request("http://localhost/api/conversations/conv-1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "综述", content: "# hi" }),
    })
    const res = await POST(req, ctx)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; title: string }
    expect(body.id).toBe("doc-1")
    expect(body.title).toBe("综述")
  })
})
