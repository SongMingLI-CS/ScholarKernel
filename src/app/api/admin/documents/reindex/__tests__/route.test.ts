import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  schedule: vi.fn(),
  provider: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({ resolveUserIdFromRequest: mocks.auth }))
vi.mock("@/lib/prisma", () => ({ prisma: { document: { findMany: mocks.findMany } } }))
vi.mock("@/lib/library-index-job", () => ({ scheduleLibraryIndexJob: mocks.schedule }))
vi.mock("@/lib/embedding-provider", () => ({ configuredEmbeddingProvider: mocks.provider }))

import { GET, POST } from "../route"

const current = {
  id: "current", userId: "owner-1", indexStatus: "ready", indexJobId: "old-job",
  fileHash: "hash", parserVersion: "layout-v2", chunkVersion: "semantic-v2",
  embeddingModelVersion: "embed-v2", embeddingStatus: "ready",
}
const stale = {
  id: "legacy", userId: "owner-2", indexStatus: "ready", indexJobId: null,
  fileHash: null, parserVersion: "layout-v1", chunkVersion: "semantic-v1",
  embeddingModelVersion: null, embeddingStatus: "unavailable",
}
const failed = {
  id: "failed", userId: "owner-3", indexStatus: "failed", indexJobId: "failed-job",
  fileHash: "hash", parserVersion: "layout-v2", chunkVersion: "semantic-v2",
  embeddingModelVersion: "embed-v2", embeddingStatus: "failed",
}

describe("/api/admin/documents/reindex", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("LIBRARY_MAINTENANCE_ADMIN_USER_IDS", "admin-1, admin-2")
    mocks.auth.mockResolvedValue("admin-1")
    mocks.findMany.mockResolvedValue([current, stale, failed])
    mocks.provider.mockReturnValue({ modelVersion: "embed-v2" })
    mocks.schedule.mockImplementation(async (_userId, id) => `job-${id}`)
  })

  afterEach(() => vi.unstubAllEnvs())

  it("rejects unauthenticated global maintenance scans", async () => {
    mocks.auth.mockResolvedValue(null)
    const response = await GET(new Request("http://localhost/api/admin/documents/reindex"))
    expect(response.status).toBe(401)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it("rejects authenticated users outside the explicit administrator allowlist", async () => {
    mocks.auth.mockResolvedValue("ordinary-user")
    const response = await GET(new Request("http://localhost/api/admin/documents/reindex"))
    expect(response.status).toBe(403)
    expect(mocks.findMany).not.toHaveBeenCalled()
  })

  it("fails closed when no administrator allowlist is configured", async () => {
    vi.stubEnv("LIBRARY_MAINTENANCE_ADMIN_USER_IDS", "")
    const response = await POST(new Request("http://localhost/api/admin/documents/reindex", { method: "POST" }))
    expect(response.status).toBe(403)
    expect(mocks.schedule).not.toHaveBeenCalled()
  })

  it("previews a bounded global page without skipping unconsumed stale documents", async () => {
    const response = await GET(new Request("http://localhost/api/admin/documents/reindex?limit=1&cursor=before"))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      staleDocumentIds: ["legacy"],
      scanned: 2,
      nextCursor: "legacy",
      hasMore: true,
    })
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: { id: "asc" },
      cursor: { id: "before" },
      skip: 1,
      take: 10,
      select: expect.objectContaining({ userId: true }),
    }))
  })

  it("schedules each document as its real owner and returns a resumable cursor", async () => {
    mocks.findMany.mockResolvedValue([stale, failed])
    const response = await POST(new Request("http://localhost/api/admin/documents/reindex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 2 }),
    }))
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({
      scheduled: [
        { documentId: "legacy", indexJobId: "job-legacy" },
        { documentId: "failed", indexJobId: "job-failed" },
      ],
      scanned: 2,
      nextCursor: "failed",
      hasMore: false,
    })
    expect(mocks.schedule).toHaveBeenNthCalledWith(1, "owner-2", "legacy")
    expect(mocks.schedule).toHaveBeenNthCalledWith(2, "owner-3", "failed")
  })
})
