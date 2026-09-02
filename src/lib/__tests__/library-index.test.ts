import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  parse: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
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

import { indexLibraryDocumentBuffer } from "@/lib/library-index"

describe("Library document indexing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteMany.mockReturnValue({ operation: "delete" })
    mocks.createMany.mockReturnValue({ operation: "create" })
    mocks.update.mockReturnValue({ operation: "update" })
    mocks.transaction.mockResolvedValue([])
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
      data: { indexStatus: "ready", indexError: null, indexedAt: expect.any(Date) },
    })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
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
})
