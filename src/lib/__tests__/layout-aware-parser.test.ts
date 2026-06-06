import { describe, expect, it } from "vitest"

import { applyColumnReorder } from "@/lib/document/column-reorder"
import { normalizeAcademicFormulas } from "@/lib/document/formula-normalizer"
import { lexicalRerankScores } from "@/lib/document/rerank-gateway"

describe("column-reorder", () => {
  it("reorders double-column blocks left then right", () => {
    const blocks = [
      { text: "Left A", x: 40, y: 700, page: 1 },
      { text: "Right A", x: 320, y: 700, page: 1 },
      { text: "Left B", x: 42, y: 680, page: 1 },
      { text: "Right B", x: 318, y: 680, page: 1 },
      { text: "Left C", x: 44, y: 660, page: 1 },
      { text: "Right C", x: 322, y: 660, page: 1 },
    ]
    const out = applyColumnReorder("", blocks)
    expect(out.layout).toBe("double")
    expect(out.text.indexOf("Left A")).toBeLessThan(out.text.indexOf("Right A"))
    expect(out.text.indexOf("Left B")).toBeLessThan(out.text.indexOf("Right B"))
  })

  it("fixes interleaved plain text columns", () => {
    const raw = ["L1", "R1", "L2", "R2", "L3", "R3", "L4", "R4"].join("\n")
    const out = applyColumnReorder(raw)
    expect(out.layout).toBe("double")
    expect(out.text.startsWith("L1\nL2\nL3\nL4")).toBe(true)
    expect(out.text.endsWith("R4")).toBe(true)
  })
})

describe("formula-normalizer", () => {
  it("wraps display equations and unicode symbols", () => {
    const raw = "(1) E = mc^2\nAlso α + β"
    const out = normalizeAcademicFormulas(raw)
    expect(out).toContain("$$E = mc^2$$")
    expect(out).toContain("\\alpha")
    expect(out).toContain("\\beta")
  })
})

describe("rerank-gateway lexical", () => {
  it("ranks query-relevant docs higher", () => {
    const scores = lexicalRerankScores("transformer attention mechanism", [
      "A survey on cooking recipes",
      "Attention is all you need: transformer architecture",
      "Random sports news",
    ])
    const sorted = [...scores].sort((a, b) => b.score - a.score)
    expect(sorted[0]?.index).toBe(1)
  })
})
