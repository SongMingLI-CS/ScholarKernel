import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findDocuments: vi.fn(),
  findChunks: vi.fn(),
  readObject: vi.fn(),
  indexBuffer: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: { findMany: mocks.findDocuments },
    documentChunk: { findMany: mocks.findChunks },
  },
}))
vi.mock("@/lib/library-storage", () => ({ readStoredLibraryObject: mocks.readObject }))
vi.mock("@/lib/library-index", () => ({ indexLibraryDocumentBuffer: mocks.indexBuffer }))

import {
  buildLibraryContextForAgent,
  loadLibraryChunksForUser,
  resolveLibraryContextForAgent,
} from "@/lib/library-resolve"

describe("Library retrieval resolution", () => {
  beforeEach(() => vi.clearAllMocks())

  it("retrieves only owned documents and ranks persisted chunks for the query", async () => {
    mocks.findDocuments.mockResolvedValue([
      { id: "doc-1", title: "Attention Study", fileType: "application/pdf", fileUrl: "object://doc-1" },
    ])
    mocks.findChunks.mockResolvedValue([
      {
        documentId: "doc-1",
        chunkIndex: 0,
        section: "Methods",
        page: 3,
        content: "Sparse attention lowers inference latency.",
      },
      {
        documentId: "doc-1",
        chunkIndex: 1,
        section: "Background",
        page: 1,
        content: "A general introduction to neural networks.",
      },
    ])

    const context = await buildLibraryContextForAgent("user-1", ["doc-1", "foreign-doc"], "attention latency")

    expect(mocks.findDocuments).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", id: { in: ["doc-1", "foreign-doc"] } },
    }))
    expect(context).toContain("Sparse attention lowers inference latency")
    expect(context.indexOf("Sparse attention lowers inference latency")).toBeLessThan(
      context.indexOf("general introduction")
    )
    expect(mocks.readObject).not.toHaveBeenCalled()
  })

  it("lazily indexes an existing document that has no stored chunks", async () => {
    mocks.findDocuments.mockResolvedValue([
      { id: "legacy", title: "Legacy.pdf", fileType: "application/pdf", fileUrl: "object://legacy" },
    ])
    mocks.findChunks.mockResolvedValue([])
    mocks.readObject.mockResolvedValue(Buffer.from("legacy"))
    mocks.indexBuffer.mockResolvedValue({
      status: "ready",
      chunks: [{
        documentId: "legacy",
        documentTitle: "Legacy.pdf",
        chunkIndex: 0,
        section: "Results",
        page: 9,
        content: "Recovered evidence.",
      }],
    })

    const chunks = await loadLibraryChunksForUser("user-1", ["legacy"])

    expect(mocks.readObject).toHaveBeenCalledWith("object://legacy")
    expect(mocks.indexBuffer).toHaveBeenCalledWith(expect.objectContaining({
      documentId: "legacy",
      documentTitle: "Legacy.pdf",
      buffer: Buffer.from("legacy"),
    }))
    expect(chunks).toHaveLength(1)
  })

  it("reports loaded, missing, and failed Library documents independently", async () => {
    mocks.findDocuments.mockResolvedValue([
      { id: "loaded", title: "Loaded.pdf", fileType: "application/pdf", fileUrl: "object://loaded" },
      { id: "failed", title: "Failed.pdf", fileType: "application/pdf", fileUrl: "object://failed" },
    ])
    mocks.findChunks.mockResolvedValue([
      { documentId: "loaded", chunkIndex: 0, section: "Intro", page: 1, content: "Loaded evidence." },
    ])
    mocks.readObject.mockResolvedValue(Buffer.from("failed"))
    mocks.indexBuffer.mockResolvedValue({ status: "failed", chunks: [], error: "Parser failed" })

    const result = await resolveLibraryContextForAgent(
      "user-1",
      ["loaded", "failed", "missing"],
      "evidence"
    )

    expect(result.statuses).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "library:loaded", state: "loaded" }),
      expect.objectContaining({ id: "library:failed", state: "failed", detail: "Parser failed" }),
      expect.objectContaining({ id: "library:missing", state: "missing" }),
    ]))
  })
})
