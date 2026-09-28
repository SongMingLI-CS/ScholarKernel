import { describe, expect, it } from "vitest"
import { normalizeReferenceSections } from "../reference-sections"
import { synthesizeCitationsMarkdown } from "../tools/search-tool"
import { markdownToCanvasHtml } from "../markdown-bridge"
import { buildPaperDetailSearchQuery } from "../agent/planner"

describe("reference sections", () => {
  it("can retrieve a paper again from the linked bibliography format", () => {
    const content = "## References\n\n- [7] [Species diversity along elevation gradients](https://example.org/paper) (2024)"
    expect(buildPaperDetailSearchQuery("详解上一篇论文", [{ role: "assistant", content }])).toBe("Species diversity along elevation gradients full paper arxiv")
  })
  it("renders a canvas bibliography once with separate items", () => {
    const html = markdownToCanvasHtml("正文 [1]。\n\n## References\n[1] First paper\n[2] Second paper\n\n## References\n[1] First paper")
    expect(html.match(/First paper/g)).toHaveLength(1)
    expect(html.match(/<li>/g)).toHaveLength(2)
  })
  it("merges repeated bibliographies while retaining unique entries and following prose", () => {
    const answer = "结论 [1]。\n\n## 参考文献 (References)\n[1] First paper (2024)\n[2] Second paper (2025)\n\n## 下一步\n继续学习。\n\n## References\n[1] First paper (2024)\n[3] Third paper (2026)"
    const output = normalizeReferenceSections(answer)
    expect(output.match(/^## 参考文献/gm)).toHaveLength(1)
    expect(output.match(/First paper/g)).toHaveLength(1)
    expect(output).toContain("## 下一步\n继续学习。")
    expect(output).toContain("- [2] Second paper")
    expect(output).toContain("- [3] Third paper")
  })
  it("does not append a second automatic list to a model bibliography", () => {
    const model = "解释 [7]。\n\n## References\n[7] Existing source"
    const output = normalizeReferenceSections(model, "## 参考文献 (References)\n[7] Existing source")
    expect(output.match(/Existing source/g)).toHaveLength(1)
    expect(output).toContain("解释 [7]。")
  })
  it("uses the fallback when the model has no bibliography, preserving source ids", () => {
    expect(normalizeReferenceSections("解释 [7]。", "## References\n[7] Source")).toBe("解释 [7]。\n\n## 参考文献 (References)\n\n- [7] Source")
  })
  it("leaves fenced examples and canvas documents intact", () => {
    const text = "```markdown\n## References\n[1] Example\n```\n\n<scholar-canvas title=\"报告\">\n## References\n[1] Canvas source\n</scholar-canvas>"
    expect(normalizeReferenceSections(text)).toBe(text)
  })
  it("preserves distinct citation numbers and continuation lines", () => {
    const output = normalizeReferenceSections("## References\n[1] A title\n  DOI: 10.1000/example\n[2] A title\n\n## References\n[1] A title\n  DOI: 10.1000/example")
    expect(output).toContain("- [2] A title")
    expect(output.match(/10.1000\/example/g)).toHaveLength(1)
  })
  it("does not fabricate references for a normal answer", () => {
    expect(normalizeReferenceSections("普通解释。", "")).toBe("普通解释。")
  })
  it("formats generated references as separate linked list items", () => {
    const result = synthesizeCitationsMarkdown([{ source_id: "7", title: "NumPy [guide]", url: "https://numpy.org/doc/", snippet: "", publishedAt: "2026" }])
    expect(result.markdown).toContain("- [7]")
    expect(result.markdown).toContain("https://numpy.org/doc/")
    expect(result.markdown).toContain("NumPy \\[guide\\]")
  })
})
