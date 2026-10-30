import { randomUUID } from "node:crypto"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ userId: "" }))
vi.mock("@/lib/auth-user", async () => {
  return {
    resolveUserIdFromRequest: async () => session.userId,
    conversationOwnerWhere: (userId: string) => ({ userId }),
  }
})

const enabled = process.env.SCHOLAR_UPGRADE_TEST_DATABASE === "1"
describe.skipIf(!enabled)("saved academic document chunks in isolated Postgres", () => {
  let userId: string
  let conversationId: string

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid")
    expect(`${url.hostname}:${url.port}${url.pathname}`).toBe("127.0.0.1:55446/scholar_upgrade")
    const { prisma } = await import("@/lib/prisma")
    userId = `document-index-${randomUUID()}`
    session.userId = userId
    await prisma.user.create({ data: { id: userId } })
    const conversation = await prisma.conversation.create({ data: { userId, title: "Synthetic document index" } })
    conversationId = conversation.id
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    if (!userId) return
    const { prisma } = await import("@/lib/prisma")
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("indexes stable evidence, returns its observed page, and replaces stale chunks on edit", async () => {
    const { POST: createDocument } = await import("@/app/api/conversations/[id]/documents/route")
    const { POST: searchDocuments } = await import("@/app/api/conversations/[id]/documents/search/route")
    const { PATCH: patchDocument } = await import("@/app/api/conversations/[id]/documents/[docId]/route")
    const ctx = { params: Promise.resolve({ id: conversationId }) }
    const created = await createDocument(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Synthetic Study.pdf",
        content: "Results\nA transformer attention experiment reports a measured improvement.\nAn unpaged methods note describes its setup.",
        chunks: [
          { text: "A transformer attention experiment reports a measured improvement.", metadata: { section: "Results", page: 3, index: 0 } },
          { text: "An unpaged methods note describes its setup.", metadata: { section: "Methods", index: 1 } },
        ],
      }),
    }), ctx)
    expect(created.status).toBe(201)
    const saved = await created.json() as { id: string; chunkCount: number }
    expect(saved.chunkCount).toBe(2)

    const searched = await searchDocuments(new Request("http://localhost", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "transformer attention measured improvement" }),
    }), ctx)
    expect(searched.status).toBe(200)
    const hits = await searched.json() as Array<{ title: string; url: string; pageNumber?: number; documentId: string; chunkId: string }>
    expect(hits[0]).toMatchObject({
      title: "Synthetic Study.pdf · Results",
      pageNumber: 3,
      documentId: saved.id,
    })
    expect(hits[0]?.url).toContain(`/chunks/${hits[0]?.chunkId}`)
    const stableChunkId = hits[0]?.chunkId

    const edited = await patchDocument(new Request("http://localhost", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "Conclusion\nA different finding discusses clinical trial recruitment." }),
    }), { params: Promise.resolve({ id: conversationId, docId: saved.id }) })
    expect(edited.status).toBe(200)
    const { prisma } = await import("@/lib/prisma")
    expect(await prisma.documentChunk.count({ where: { documentId: saved.id } })).toBe(1)
    expect(await prisma.documentChunk.findUnique({ where: { id: stableChunkId } })).toBeNull()
  })

  it("lazily indexes existing saved text and keeps its page unknown", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { POST: searchDocuments } = await import("@/app/api/conversations/[id]/documents/search/route")
    const legacy = await prisma.document.create({
      data: { conversationId, title: "Legacy saved notes", content: "## Results\nA reproducible synthetic retrieval finding." },
    })
    const response = await searchDocuments(new Request("http://localhost", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "reproducible retrieval finding" }),
    }), { params: Promise.resolve({ id: conversationId }) })
    expect(response.status).toBe(200)
    const hits = await response.json() as Array<{ documentId: string; pageNumber?: number }>
    expect(hits.find((hit) => hit.documentId === legacy.id)).toBeDefined()
    expect(hits.find((hit) => hit.documentId === legacy.id)?.pageNumber).toBeUndefined()
  })

  it("persists pinned local vectors and returns local cross-encoder provenance", async () => {
    const model = "fixture-embedder"
    const revision = "fixture-revision-1"
    vi.stubEnv("LOCAL_EMBEDDING_API_URL", "http://127.0.0.1:8999/v1/embeddings")
    vi.stubEnv("LOCAL_EMBEDDING_MODEL", model)
    vi.stubEnv("LOCAL_EMBEDDING_REVISION", revision)
    vi.stubEnv("LOCAL_EMBEDDING_DIMENSIONS", "2")
    vi.stubEnv("LOCAL_RERANKER_API_URL", "http://127.0.0.1:8999/v1/rerank")
    vi.stubEnv("LOCAL_RERANKER_MODEL", "fixture-cross-encoder")
    vi.stubEnv("LOCAL_RERANKER_REVISION", "fixture-rerank-r1")

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body)) as { input?: string[]; documents?: string[] }
      if (url === "http://127.0.0.1:8999/v1/embeddings") {
        const inputTexts = body.input ?? []
        return new Response(JSON.stringify({
          model,
          revision,
          dimensions: 2,
          embeddings: inputTexts.map((text) => text.toLowerCase().includes("attention") ? [1, 0] : [0, 1]),
        }), { status: 200, headers: { "content-type": "application/json" } })
      }
      if (url === "http://127.0.0.1:8999/v1/rerank") {
        return new Response(JSON.stringify({
          model: "fixture-cross-encoder",
          revision: "fixture-rerank-r1",
          results: [{ index: 1, score: 0.95 }, { index: 0, score: 0.1 }],
        }), { status: 200, headers: { "content-type": "application/json" } })
      }
      throw new Error(`Unexpected fixture endpoint: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)

    const { prisma } = await import("@/lib/prisma")
    const { POST: createDocument } = await import("@/app/api/conversations/[id]/documents/route")
    const { POST: searchDocuments } = await import("@/app/api/conversations/[id]/documents/search/route")
    const ctx = { params: Promise.resolve({ id: conversationId }) }
    const created = await createDocument(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Synthetic Hybrid Retrieval.pdf",
        content: "attention evidence\nmethods setup",
        chunks: [
          { text: "attention evidence", metadata: { section: "Results", page: 4, index: 0 } },
          { text: "methods setup", metadata: { section: "Methods", page: 9, index: 1 } },
        ],
      }),
    }), ctx)
    expect(created.status).toBe(201)
    const createdBody = await created.json() as { id: string; embeddingStatus: string }
    expect(createdBody.embeddingStatus).toBe("indexed")
    const stored = await prisma.documentChunk.findMany({
      where: { documentId: createdBody.id },
      select: { embeddingModel: true, embeddingRevision: true, embedding: true },
    })
    expect(stored).toHaveLength(2)
    expect(stored.every((chunk) => chunk.embeddingModel === model && chunk.embeddingRevision === revision && Array.isArray(chunk.embedding))).toBe(true)

    const response = await searchDocuments(new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "attention" }),
    }), ctx)
    expect(response.status).toBe(200)
    const hits = await response.json() as Array<{ documentId: string; pageNumber?: number; rerankScore?: number; rerankerModel?: string }>
    expect(hits[0]).toMatchObject({
      documentId: createdBody.id,
      pageNumber: 9,
      rerankScore: 0.95,
      rerankerModel: "fixture-cross-encoder@fixture-rerank-r1",
    })
    const endpointCalls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(endpointCalls.filter((url) => url.endsWith("/v1/embeddings")).length).toBeGreaterThanOrEqual(2)
    expect(endpointCalls.filter((url) => url.endsWith("/v1/rerank"))).toHaveLength(1)
    expect(endpointCalls.every((url) => url.startsWith("http://127.0.0.1:8999/"))).toBe(true)
  })
})
