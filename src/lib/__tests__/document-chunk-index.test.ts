import { describe, expect, it } from "vitest"

import { buildDocumentChunkRows } from "@/lib/document/document-chunk-index"

describe("academic document chunk indexing", () => {
  it("creates stable IDs and content hashes while preserving only observed page metadata", () => {
    const parsed = [{ text: "Evidence from the source.", metadata: { section: "Results", page: 4, index: 0 } }]
    const first = buildDocumentChunkRows("doc-fixture", "Evidence from the source.", parsed)
    const again = buildDocumentChunkRows("doc-fixture", "Evidence from the source.", parsed)
    const changed = buildDocumentChunkRows("doc-fixture", "Different source content.", [
      { text: "Different source content.", metadata: { section: "Results", index: 0 } },
    ])
    const shifted = buildDocumentChunkRows("doc-fixture", "Prefix\nEvidence from the source.", [
      { text: "A new unrelated prefix.", metadata: { section: "Introduction", index: 0 } },
      { text: "Evidence from the source.", metadata: { section: "Results", page: 4, index: 1 } },
    ])

    expect(first[0]).toMatchObject({ section: "Results", pageNumber: 4, parserVersion: "academic-semantic-v2" })
    expect(first[0]?.id).toBe(again[0]?.id)
    expect(first[0]?.contentHash).toBe(again[0]?.contentHash)
    expect(first[0]?.id).not.toBe(changed[0]?.id)
    expect(shifted.find((row) => row.content === first[0]?.content)?.id).toBe(first[0]?.id)
    expect(changed[0]?.pageNumber).toBeNull()
    expect(first[0]?.id).toMatch(/^[a-f0-9]{64}$/)
  })

  it("chunks text when no parse metadata is supplied", () => {
    const rows = buildDocumentChunkRows("text-fixture", "## Introduction\nAcademic evidence about retrieval.")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ section: "Introduction", pageNumber: null, content: expect.stringContaining("Academic evidence") })
  })
})
