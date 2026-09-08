import { describe, expect, it } from "vitest"

import {
  formatRetrievedLibraryContext,
  formatStructuredLibraryEvidence,
  rankLibraryChunksBm25,
  reciprocalRankFusion,
  retrieveRelevantLibraryChunks,
  retrieveStructuredLibraryEvidence,
  selectStructuredEvidence,
  splitLibraryChunkText,
} from "@/lib/library-rag"

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
  it("keeps a deterministic BM25-only path", () => {
    const first = rankLibraryChunksBm25("sparse attention latency", chunks)
    const second = rankLibraryChunksBm25("sparse attention latency", chunks)
    expect(first.map((chunk) => chunk.lexicalRank)).toEqual(second.map((chunk) => chunk.lexicalRank))
    expect(first[0]).toMatchObject({ documentId: "d1", section: "Experiments", lexicalRank: 1 })
  })

  it("uses reciprocal-rank fusion instead of adding incomparable scores", () => {
    const lexical = rankLibraryChunksBm25("attention", chunks)
    const vector = [
      { ...chunks[2]!, vectorRank: 1, vectorScore: 0.99 },
      { ...chunks[0]!, vectorRank: 2, vectorScore: 0.8 },
    ]
    const once = reciprocalRankFusion(lexical, vector)
    const twice = reciprocalRankFusion(lexical, vector)
    expect(once.map((chunk) => chunk.documentId + chunk.chunkIndex)).toEqual(twice.map((chunk) => chunk.documentId + chunk.chunkIndex))
    expect(once.every((chunk) => typeof chunk.fusedRank === "number")).toBe(true)
  })

  it("degrades explicitly to lexical retrieval when vectors are unavailable", () => {
    const evidence = retrieveStructuredLibraryEvidence("ablation latency", chunks, { vectorUnavailable: true })
    expect(evidence[0]?.scoreExplanation.method).toBe("bm25")
    expect(evidence[0]?.scoreExplanation.degraded).toBe("vector-unavailable")
  })

  it("enforces document quotas, removes duplicates, and merges adjacent chunks", () => {
    const ranked = [
      { ...chunks[0]!, chunkId: "c0", headingPath: ["Methods"], lexicalRank: 1, fusedRank: 1, fusedScore: 1 },
      { ...chunks[0]!, chunkId: "duplicate", headingPath: ["Methods"], lexicalRank: 2, fusedRank: 2, fusedScore: 0.9 },
      { ...chunks[1]!, chunkId: "c1", headingPath: ["Methods"], lexicalRank: 3, fusedRank: 3, fusedScore: 0.8 },
      { ...chunks[2]!, chunkId: "c2", lexicalRank: 4, fusedRank: 4, fusedScore: 0.7 },
    ]
    const evidence = selectStructuredEvidence(ranked, { maxChunks: 4, maxChunksPerDocument: 2 })
    expect(evidence).toHaveLength(2)
    expect(evidence[0]?.mergedChunkIds).toEqual(["c0", "c1"])
    expect(evidence[1]?.documentId).toBe("d2")
  })

  it("preserves stable page, heading path, paragraph range, and citation identity", () => {
    const evidence = selectStructuredEvidence([{
      ...chunks[1]!, chunkId: "stable-id", headingPath: ["Experiments", "Ablations"],
      paragraphStart: 7, paragraphEnd: 9, lexicalRank: 1, fusedRank: 1, fusedScore: 1,
    }])
    expect(evidence[0]).toMatchObject({ chunkId: "stable-id", pageNumber: 7, headingPath: ["Experiments", "Ablations"], paragraphStart: 7, paragraphEnd: 9 })
    const formatted = formatStructuredLibraryEvidence(evidence)
    expect(formatted).toContain("[LIB:d1:stable-id p.7]")
    expect(formatted).toContain("Experiments > Ablations")
  })
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
