import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  persistEmbeddings: vi.fn(),
}))

vi.mock("@/lib/document/layout-aware-parser", () => ({
  parseLayoutAwareDocument: mocks.parse,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    documentChunk: {
      deleteMany: mocks.deleteMany,
      createMany: mocks.createMany,
    },
    document: { update: mocks.update },
    $transaction: mocks.transaction,
  },
}))
vi.mock("@/lib/library-vector-store", () => ({ persistChunkEmbeddings: mocks.persistEmbeddings }))

import { indexLibraryDocumentBuffer, libraryIndexFingerprint, libraryIndexNeedsRebuild } from "@/lib/library-index"

describe("Library document indexing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteMany.mockReturnValue({ operation: "delete" })
    mocks.createMany.mockReturnValue({ operation: "create" })
    mocks.update.mockReturnValue({ operation: "update" })
    mocks.transaction.mockResolvedValue([])
    mocks.persistEmbeddings.mockResolvedValue(undefined)
  })

  it("persists bounded section chunks and marks the document ready", async () => {
    mocks.parse.mockResolvedValue({
      chunks: [
        {
          text: "method paragraph ".repeat(400),
          metadata: { section: "Methods", page: 4, index: 0 },
        },
      ],
    })

    const result = await indexLibraryDocumentBuffer({
      documentId: "doc-1",
      documentTitle: "Paper",
      filename: "paper.pdf",
      fileType: "application/pdf",
      buffer: Buffer.from("pdf"),
    })

    expect(result.status).toBe("ready")
    expect(result.chunks.length).toBeGreaterThan(1)
    expect(result.chunks.every((chunk) => chunk.content.length <= 2_400)).toBe(true)
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          documentId: "doc-1",
          chunkIndex: 0,
          section: "Methods",
          page: 4,
        }),
      ]),
    })
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: expect.objectContaining({
        indexStatus: "ready", indexError: null, indexedAt: expect.any(Date),
        parserVersion: "layout-v2", chunkVersion: "semantic-v2", embeddingStatus: "unavailable",
      }),
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })

  it("does not require rebuilding the same file and versions", () => {
    const desired = libraryIndexFingerprint(Buffer.from("same"), "fake-v1")
    expect(libraryIndexNeedsRebuild(desired, desired)).toBe(false)
  })

  it("requires incremental rebuild when file, parser, chunker, or model changes", () => {
    const desired = libraryIndexFingerprint(Buffer.from("same"), "fake-v1")
    expect(libraryIndexNeedsRebuild({ ...desired, fileHash: "changed" }, desired)).toBe(true)
    expect(libraryIndexNeedsRebuild({ ...desired, parserVersion: "old" }, desired)).toBe(true)
    expect(libraryIndexNeedsRebuild({ ...desired, chunkVersion: "old" }, desired)).toBe(true)
    expect(libraryIndexNeedsRebuild({ ...desired, embeddingModelVersion: "fake-v0" }, desired)).toBe(true)
  })

  it("records an index failure without throwing away the uploaded document", async () => {
    mocks.parse.mockRejectedValue(new Error("parser unavailable"))
    mocks.update.mockResolvedValue({})

    const result = await indexLibraryDocumentBuffer({
      documentId: "doc-2",
      documentTitle: "Paper",
      filename: "paper.pdf",
      fileType: "application/pdf",
      buffer: Buffer.from("pdf"),
    })

    expect(result).toEqual({ status: "failed", chunks: [], error: "parser unavailable" })
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "doc-2" },
      data: { indexStatus: "failed", indexError: "parser unavailable", indexedAt: null },
    })
  })

  it("embeds indexed chunks through a configurable provider", async () => {
    mocks.parse.mockResolvedValue({ chunks: [{ text: "embedding source", metadata: { section: "Methods", headingPath: ["Methods"], page: 2, paragraphStart: 1, paragraphEnd: 1, index: 0 } }] })
    const provider = {
      modelVersion: "fake-1536-v1",
      dimensions: 1536,
      embed: vi.fn(async (texts: string[]) => texts.map(() => Array(1536).fill(0.01))),
    }
    const result = await indexLibraryDocumentBuffer({
      documentId: "doc-vector", documentTitle: "Paper", filename: "paper.txt", fileType: "text/plain",
      buffer: Buffer.from("embedding source"), embeddingProvider: provider,
    })
    expect(result.embeddingStatus).toBe("ready")
    expect(provider.embed).toHaveBeenCalledTimes(1)
    expect(mocks.persistEmbeddings).toHaveBeenCalledWith([
      expect.objectContaining({ modelVersion: "fake-1536-v1", embedding: expect.any(Array) }),
    ])
    expect(mocks.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ embeddingStatus: "ready" }) }))
  })

  it("uses the configured embedding batch size", async () => {
    const previous = process.env.EMBEDDING_BATCH_SIZE
    process.env.EMBEDDING_BATCH_SIZE = "1"
    mocks.parse.mockResolvedValue({ chunks: [
      { text: "one", metadata: { section: "Methods", headingPath: ["Methods"], page: 2, paragraphStart: 1, paragraphEnd: 1, index: 0 } },
      { text: "two", metadata: { section: "Results", headingPath: ["Results"], page: 3, paragraphStart: 2, paragraphEnd: 2, index: 1 } },
    ] })
    const provider = { modelVersion: "fake-1536-v1", dimensions: 1536, embed: vi.fn(async () => [Array.from({ length: 1536 }, () => 0)]) }
    await indexLibraryDocumentBuffer({
      documentId: "doc-batches", documentTitle: "Paper", filename: "paper.txt", fileType: "text/plain",
      buffer: Buffer.from("one two"), embeddingProvider: provider,
    })
    expect(provider.embed).toHaveBeenCalledTimes(2)
    if (previous === undefined) delete process.env.EMBEDDING_BATCH_SIZE
    else process.env.EMBEDDING_BATCH_SIZE = previous
  })
})
