import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET as getPublicShare } from "@/app/api/public/share/[token]/route"
import { DELETE as deleteCanvasShare, POST as postCanvasShare } from "@/app/api/canvas/[id]/share/route"
import {
  isAuthRequiredInMiddleware,
  isPublicPath,
  MIDDLEWARE_MATCHER,
} from "@/lib/middleware-auth"
import {
  buildSharePath,
  generateShareToken,
  isSharePublicApiPath,
  isSharePublicPagePath,
  toPublicShareDocument,
} from "@/lib/public-share"

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
    canvasDocument: { findFirst, update },
  },
}))

import { resolveUserIdFromRequest } from "@/lib/auth-user"

const shareCtx = { params: Promise.resolve({ token: "tok-live" }) }
const canvasCtx = { params: Promise.resolve({ id: "doc-1" }) }

describe("public-share", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveUserIdFromRequest).mockResolvedValue("user-test")
  })

  it("generates high-entropy opaque share tokens", () => {
    const a = generateShareToken()
    const b = generateShareToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(buildSharePath(a)).toBe(`/share/${a}`)
  })

  it("strips owner metadata from public payloads", () => {
    const payload = toPublicShareDocument({
      title: "综述",
      content: "# Hello",
      version: 2,
      updatedAt: new Date("2026-06-01T08:00:00.000Z"),
    })
    expect(payload).toEqual({
      title: "综述",
      content: "# Hello",
      version: 2,
      updatedAt: "2026-06-01T08:00:00.000Z",
    })
    expect(payload).not.toHaveProperty("conversationId")
    expect(payload).not.toHaveProperty("userId")
  })

  it("whitelists share page and public API in middleware policy", () => {
    expect(isSharePublicPagePath("/share/abc123")).toBe(true)
    expect(isSharePublicApiPath("/api/public/share/abc123")).toBe(true)
    expect(isPublicPath("/share/abc123")).toBe(true)
    expect(isPublicPath("/api/public/share/abc123")).toBe(true)
    expect(isAuthRequiredInMiddleware("/share/abc123", "secret")).toBe(false)
    expect(isAuthRequiredInMiddleware("/api/public/share/abc123", "secret")).toBe(false)
    expect(MIDDLEWARE_MATCHER.join(" ")).toContain("/share/:path*")
    expect(MIDDLEWARE_MATCHER.join(" ")).toContain("/api/public/:path*")
  })

  it("allows anonymous access to /share/[token] without session (middleware black-box)", () => {
    const token = generateShareToken()
    const pathname = buildSharePath(token)
    expect(isAuthRequiredInMiddleware(pathname, "production-auth-password")).toBe(false)
    expect(isPublicPath(pathname)).toBe(true)
  })

  it("returns 200 with sanitized document for active public share token", async () => {
    findFirst.mockResolvedValueOnce({
      title: "公开报告",
      content: "## 摘要\n正文",
      version: 1,
      updatedAt: new Date("2026-06-01T08:00:00.000Z"),
    })
    const req = new Request("http://localhost/api/public/share/tok-live")
    const res = await getPublicShare(req, shareCtx)
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.title).toBe("公开报告")
    expect(body.content).toContain("摘要")
    expect(body).not.toHaveProperty("conversationId")
    expect(body).not.toHaveProperty("userId")
  })

  it("returns 404 when share is revoked (isShared=false / token erased)", async () => {
    findFirst.mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/public/share/tok-revoked")
    const res = await getPublicShare(req, { params: Promise.resolve({ token: "tok-revoked" }) })
    expect(res.status).toBe(404)
  })

  it("POST enables share and DELETE revokes — link 404 after revoke", async () => {
    findFirst.mockResolvedValueOnce({ id: "doc-1", isShared: false, shareToken: null })
    update.mockResolvedValue({})

    const postReq = new Request("http://localhost/api/canvas/doc-1/share", { method: "POST" })
    const postRes = await postCanvasShare(postReq, canvasCtx)
    expect(postRes.status).toBe(200)
    const link = (await postRes.json()) as { sharePath: string; shareToken: string; shareUrl: string }
    expect(link.sharePath).toMatch(/^\/share\/.+/)
    expect(link.shareUrl).toContain(link.shareToken)

    findFirst.mockResolvedValueOnce({
      title: "Live",
      content: "body",
      version: 1,
      updatedAt: new Date("2026-06-01T08:00:00.000Z"),
    })
    let publicRes = await getPublicShare(
      new Request(`http://localhost/api/public/share/${link.shareToken}`),
      { params: Promise.resolve({ token: link.shareToken }) }
    )
    expect(publicRes.status).toBe(200)

    findFirst.mockResolvedValueOnce({ id: "doc-1", isShared: true, shareToken: link.shareToken })
    const delReq = new Request("http://localhost/api/canvas/doc-1/share", { method: "DELETE" })
    const delRes = await deleteCanvasShare(delReq, canvasCtx)
    expect(delRes.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isShared: false, shareToken: null },
      })
    )

    findFirst.mockResolvedValueOnce(null)
    publicRes = await getPublicShare(
      new Request(`http://localhost/api/public/share/${link.shareToken}`),
      { params: Promise.resolve({ token: link.shareToken }) }
    )
    expect(publicRes.status).toBe(404)
  })
})
