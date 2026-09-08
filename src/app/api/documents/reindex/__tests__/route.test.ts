import { beforeEach, describe, expect, it, vi } from "vitest"

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

const docs = [
  { id: "legacy", indexStatus: "ready", indexJobId: null, fileHash: null, parserVersion: "layout-v1", chunkVersion: "semantic-v1", embeddingModelVersion: null, embeddingStatus: "unavailable" },
  { id: "current", indexStatus: "ready", indexJobId: "old-job", fileHash: "hash", parserVersion: "layout-v2", chunkVersion: "semantic-v2", embeddingModelVersion: "embed-v2", embeddingStatus: "ready" },
  { id: "in-flight", indexStatus: "pending", indexJobId: "active-job", fileHash: null, parserVersion: "layout-v1", chunkVersion: "semantic-v1", embeddingModelVersion: null, embeddingStatus: "pending" },
]

describe("/api/documents/reindex", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue("user-1")
    mocks.findMany.mockResolvedValue(docs)
    mocks.provider.mockReturnValue({ modelVersion: "embed-v2" })
    mocks.schedule.mockImplementation(async (_userId, id) => `job-${id}`)
  })

  it("previews only stale owned documents and skips an active index job", async () => {
    const res = await GET(new Request("http://localhost/api/documents/reindex?limit=10"))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ staleDocumentIds: ["legacy"], totalScanned: 3 })
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }))
  })

  it("schedules a bounded user-scoped maintenance batch", async () => {
    const res = await POST(new Request("http://localhost/api/documents/reindex", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 1 }),
    }))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ scheduled: [{ documentId: "legacy", indexJobId: "job-legacy" }], remainingStale: 0 })
    expect(mocks.schedule).toHaveBeenCalledTimes(1)
  })

  it("rejects unauthenticated maintenance scans", async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await POST(new Request("http://localhost/api/documents/reindex", { method: "POST" }))).status).toBe(401)
    expect(mocks.schedule).not.toHaveBeenCalled()
  })
})
