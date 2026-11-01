import { describe, expect, it } from "vitest"

import { semanticChunkAcademicText } from "@/lib/document/academic-semantic-chunker"
import type { LayoutTextBlock, PageGeometry } from "@/lib/document/column-reorder"

const THREE_PAGES: PageGeometry[] = [
  { page: 1, width: 612, height: 792 },
  { page: 2, width: 612, height: 792 },
  { page: 3, width: 612, height: 792 },
]

function buildBody(lines: number): string {
  return Array.from(
    { length: lines },
    (_, i) => `Paragraph ${i} discusses attention mechanisms, retrieval augmentation and reranking in detail.`
  ).join("\n")
}

/**
 * 回归：无坐标块时页码必须按字符偏移估算，而不是全部塌缩到第 1 页。
 * 历史实现里 inferPageForText 的 fallback=1 让 estimatePageFromOffset 成为死代码，
 * 于是任何走纯文本兜底的 PDF 都只产出 page:1，引用定位（SK-05）随之失真。
 */
describe("semantic chunk page metadata", () => {
  it("estimates distinct pages from char offset when layout blocks are absent", () => {
    const body = buildBody(60)
    const text = [
      "# Abstract",
      body.slice(0, 1200),
      "# Introduction",
      body.slice(0, 1600),
      "# Methodology",
      body.slice(0, 1600),
    ].join("\n")

    const chunks = semanticChunkAcademicText({ text, blocks: [], pageGeometries: THREE_PAGES })
    expect(chunks.length).toBe(3)
    const pages = chunks.map((c) => c.metadata.page)
    expect(new Set(pages).size).toBeGreaterThan(1)
    expect(pages[0]).toBe(1)
    expect(pages[2]).toBeGreaterThan(pages[0]!)
  })

  it("keeps page 1 when nothing is known about pagination", () => {
    const chunks = semanticChunkAcademicText({
      text: "# Abstract\nShort body about RAG.\n# Conclusion\nWe conclude RAG works.",
    })
    expect(chunks.every((c) => c.metadata.page === 1)).toBe(true)
  })

  it("still prefers the page carried by matching layout blocks", () => {
    const line = "Quantitative results confirm a 4.2 point recall gain across all three benchmarks."
    const blocks: LayoutTextBlock[] = [{ text: line, x: 60, y: 700, page: 3 }]
    const text = ["# Abstract", buildBody(30), "# Results", line, buildBody(20)].join("\n")

    const chunks = semanticChunkAcademicText({ text, blocks, pageGeometries: THREE_PAGES })
    const results = chunks.find((c) => c.metadata.section === "Results")
    expect(results?.metadata.page).toBe(3)
  })
})
