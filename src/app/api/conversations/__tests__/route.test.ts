import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET, POST } from "../route"

const { findMany, create } = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(() => "user-test"),
  conversationOwnerWhere: (userId: string) => ({ userId }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      findMany,
      create,
    },
  },
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

describe("/api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockReturnValue("user-test")
  })

  it("GET returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUserIdFromRequest).mockReturnValueOnce(null)
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
})
