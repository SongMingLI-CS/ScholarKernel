import { describe, expect, it } from "vitest"

import { containsMathSignals, normalizeAcademicFormulas, replaceUnicodeMathSymbols } from "@/lib/document/formula-normalizer"

/**
 * replaceUnicodeMathSymbols 的等价性基线。
 * 该函数历史上对每个符号各做一次 split/join（27 次全串扫描 + 拷贝），
 * 是文档流水线里最慢的一步；优化为单次正则替换后，此测试锁定行为不变。
 */
const SYMBOLS: Array<[string, string]> = [
  ["α", "\\alpha"],
  ["β", "\\beta"],
  ["γ", "\\gamma"],
  ["δ", "\\delta"],
  ["ε", "\\epsilon"],
  ["θ", "\\theta"],
  ["λ", "\\lambda"],
  ["μ", "\\mu"],
  ["π", "\\pi"],
  ["σ", "\\sigma"],
  ["φ", "\\phi"],
  ["ω", "\\omega"],
  ["∑", "\\sum"],
  ["∏", "\\prod"],
  ["∫", "\\int"],
  ["√", "\\sqrt"],
  ["∞", "\\infty"],
  ["≤", "\\leq"],
  ["≥", "\\geq"],
  ["≠", "\\neq"],
  ["≈", "\\approx"],
  ["±", "\\pm"],
  ["×", "\\times"],
  ["÷", "\\div"],
  ["∈", "\\in"],
  ["∂", "\\partial"],
  ["∇", "\\nabla"],
]

describe("replaceUnicodeMathSymbols equivalence", () => {
  it("maps every supported symbol exactly once per occurrence", () => {
    for (const [symbol, latex] of SYMBOLS) {
      const out = replaceUnicodeMathSymbols(`a ${symbol} b ${symbol}`)
      expect(out).toBe(`a ${latex} b ${latex}`)
    }
  })

  it("replaces symbols inside longer sentences without touching plain text", () => {
    const input = "设 α + β ≤ γ，且 ∫ f(x) dx ≈ ∞。"
    expect(replaceUnicodeMathSymbols(input)).toBe(
      "设 \\alpha + \\beta \\leq \\gamma，且 \\int f(x) dx \\approx \\infty。"
    )
  })

  it("is a no-op for text without math symbols", () => {
    const input = "普通中文段落，English only, 12345."
    expect(replaceUnicodeMathSymbols(input)).toBe(input)
  })

  it("detects every supported symbol via containsMathSignals", () => {
    for (const [symbol] of SYMBOLS) {
      expect(containsMathSignals(`x ${symbol} y`)).toBe(true)
    }
    expect(containsMathSignals("pure prose without math")).toBe(false)
  })

  it("keeps multi-symbol paragraphs stable through the full pipeline", () => {
    const out = normalizeAcademicFormulas("α and β and ∇ and ∑")
    expect(out).toContain("\\alpha")
    expect(out).toContain("\\nabla")
    expect(out).toContain("\\sum")
  })
})
