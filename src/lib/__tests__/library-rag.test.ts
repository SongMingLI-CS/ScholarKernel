import { describe, expect, it } from "vitest"

import { formatRetrievedLibraryContext, retrieveRelevantLibraryChunks, splitLibraryChunkText } from "@/lib/library-rag"

const chunks = [
  {
    documentId: "d1",
    documentTitle: "Transformer Paper",
    chunkIndex: 0,
    section: "Introduction",
    page: 1,
    content: "Transformers use self attention for sequence modeling.",
  },
  {
    documentId: "d1",
    documentTitle: "Transformer Paper",
    chunkIndex: 1,
    section: "Experiments",
    page: 7,
    content: "The ablation study compares sparse attention latency and accuracy on ImageNet.",
  },
  {
    documentId: "d2",
    documentTitle: "Unrelated Biology",
    chunkIndex: 0,
    section: "Methods",
    page: 3,
    content: "Cells were cultured at room temperature and inspected by microscopy.",
  },
]

describe("Library chunk retrieval", () => {
  it("ranks query-relevant chunks ahead of unrelated document text", () => {
    const selected = retrieveRelevantLibraryChunks("sparse attention ablation latency", chunks, {
      maxChunks: 2,
      maxChars: 1000,
    })
    expect(selected[0]).toMatchObject({ documentId: "d1", section: "Experiments", page: 7 })
    expect(selected.some((chunk) => chunk.documentId === "d2")).toBe(false)
  })

  it("enforces the context budget instead of injecting complete documents", () => {
    const selected = retrieveRelevantLibraryChunks("attention", chunks, { maxChunks: 10, maxChars: 70 })
    expect(selected.length).toBe(1)
    expect(selected.reduce((sum, chunk) => sum + chunk.content.length, 0)).toBeLessThanOrEqual(70)
  })

  it("formats document, section, page, and chunk identity for evidence tracing", () => {
    const selected = retrieveRelevantLibraryChunks("ablation", chunks, { maxChunks: 1, maxChars: 500 })
    const context = formatRetrievedLibraryContext(selected)
    expect(context).toContain("Transformer Paper")
    expect(context).toContain("Experiments")
    expect(context).toContain("p.7")
    expect(context).toContain("chunk 1")
  })

  it("splits oversized academic sections into bounded retrieval units", () => {
    const parts = splitLibraryChunkText(`${"method paragraph ".repeat(90)}\n\n${"result paragraph ".repeat(90)}`, 500)
    expect(parts.length).toBeGreaterThan(2)
    expect(parts.every((part) => part.length <= 500)).toBe(true)
    expect(parts.join("\n")).toContain("method paragraph")
    expect(parts.join("\n")).toContain("result paragraph")
  })
})
