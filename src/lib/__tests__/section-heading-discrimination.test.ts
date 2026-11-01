import { describe, expect, it } from "vitest"

import { detectSectionTitle, semanticChunkAcademicText } from "@/lib/document/academic-semantic-chunker"

/**
 * 回归：SECTION_HEADING_RE 只看行首是否是章节关键字，
 * 于是「以 Methodology / Results 等词开头的正文行」会被当成标题，
 * 每行都切出一个 chunk（每块还额外加一遍 `## [Section]` 前缀）。
 * 实测 12 行这样的正文会让 prompt 体积额外膨胀约 58%，并破坏章节归属。
 */
const BODY_LINES_STARTING_WITH_KEYWORDS = Array.from(
  { length: 12 },
  (_, i) => `Methodology 第 ${i} 段讨论稀疏路由、检索增强与重排序的实现细节与实验结果。`
)

describe("detectSectionTitle heading discrimination", () => {
  it("accepts genuine headings", () => {
    expect(detectSectionTitle("1. Introduction")).toBe("Introduction")
    expect(detectSectionTitle("2. Related Work")).toBe("Related Work")
    expect(detectSectionTitle("## 3. Methodology")).toBe("Methodology")
    expect(detectSectionTitle("References")).toBe("References")
    expect(detectSectionTitle("Appendix A")).toBe("Appendix")
    expect(detectSectionTitle("IV. Conclusion")).toBe("Conclusion")
    expect(detectSectionTitle("# Attention Is All You Need")).toBe("Attention Is All You Need")
  })

  it("rejects body lines that merely start with a section keyword", () => {
    for (const line of BODY_LINES_STARTING_WITH_KEYWORDS.slice(0, 4)) {
      expect(detectSectionTitle(line)).toBeNull()
    }
  })

  it("rejects full sentences that open with a keyword", () => {
    expect(detectSectionTitle("Results show a 4.2 point gain on all three benchmarks.")).toBeNull()
    expect(detectSectionTitle("Experiments on ImageNet and CIFAR validate the approach.")).toBeNull()
    expect(detectSectionTitle("Discussion of limitations is deferred to the appendix.")).toBeNull()
  })

  it("rejects overlong heading candidates", () => {
    const long = `Conclusion ${"and".repeat(40)}`
    expect(long.length).toBeGreaterThan(80)
    expect(detectSectionTitle(long)).toBeNull()
  })
})

describe("chunking with keyword-initial body lines", () => {
  it("does not split every line into its own chunk", () => {
    const text = [
      "# Abstract",
      "Short abstract about sparse routing.",
      "# Methodology",
      ...BODY_LINES_STARTING_WITH_KEYWORDS,
      "# Results",
      "We report a 4.2 point recall gain.",
    ].join("\n")

    const chunks = semanticChunkAcademicText({ text })
    expect(chunks).toHaveLength(3)
    expect(chunks.map((c) => c.metadata.section)).toEqual(["Abstract", "Methodology", "Results"])

    const methodology = chunks[1]!
    expect(methodology.text.split("\n").length).toBe(BODY_LINES_STARTING_WITH_KEYWORDS.length + 1)
  })

  it("keeps prompt growth bounded for keyword-heavy documents", () => {
    const text = ["# Methodology", ...BODY_LINES_STARTING_WITH_KEYWORDS].join("\n")
    const chunks = semanticChunkAcademicText({ text })
    const rendered = chunks.map((c) => `## [${c.metadata.section}]\n${c.text}`).join("\n")
    expect(rendered.length / text.length).toBeLessThan(1.15)
  })
})
