import { describe, expect, it } from "vitest"

import { extractReferencesFromMarkdown, serializeReferencesAsBibTeX } from "@/lib/utils/citation-parser"

/**
 * 回归：extractReferencesFromMarkdown 一旦命中参考文献标题就永不结束，
 * 之后任何非空行（包括 `## Appendix` 这类新小节及其正文）都会被当成一条文献。
 * 该函数被 canvas 的 .bib 导出直接调用，后果是导出的 BibTeX 里混入正文段落。
 */
const DOC_WITH_APPENDIX = [
  "# Results",
  "We report a 4.2 point gain.",
  "",
  "## References",
  "",
  "[1] Vaswani, A., Shazeer, N. (2017). Attention is all you need. NeurIPS. DOI:10.5555/3295222",
  "[2] Lewis, P. (2020). Retrieval-augmented generation for knowledge-intensive NLP. NeurIPS.",
  "",
  "## Appendix",
  "",
  "This appendix describes the full hyperparameter grid and the annotation protocol used by two annotators.",
  "",
  "### A.1 Annotation protocol",
  "",
  "Annotators were instructed to label each claim as supported, unsupported, or ambiguous.",
].join("\n")

describe("extractReferencesFromMarkdown section termination", () => {
  it("stops at the next markdown heading instead of swallowing the appendix", () => {
    const refs = extractReferencesFromMarkdown(DOC_WITH_APPENDIX)
    expect(refs).toHaveLength(2)
    const titles = refs.map((r) => r.title)
    expect(titles[0]).toContain("Attention is all you need")
    expect(titles[1]).toContain("Retrieval-augmented generation")
    expect(titles.join(" | ")).not.toContain("hyperparameter grid")
    expect(titles.join(" | ")).not.toContain("Annotation protocol")
    expect(titles.join(" | ")).not.toContain("Appendix")
  })

  it("keeps parsed metadata for the entries it does collect", () => {
    const refs = extractReferencesFromMarkdown(DOC_WITH_APPENDIX)
    expect(refs[0]?.authors).toEqual(["Vaswani, A.", "Shazeer, N."])
    expect(refs[0]?.year).toBe("2017")
    expect(refs[0]?.doi).toBe("10.5555/3295222")
  })

  it("does not emit appendix text into the exported BibTeX", () => {
    const bib = serializeReferencesAsBibTeX(extractReferencesFromMarkdown(DOC_WITH_APPENDIX))
    expect(bib).toContain("Attention is all you need")
    expect(bib).not.toContain("annotation protocol")
    expect(bib).not.toContain("hyperparameter grid")
  })

  it("handles the Chinese references heading with the same termination rule", () => {
    const md = ["## 参考文献", "[1] 张三 (2021). 检索增强生成综述. 计算机学报.", "## 附录", "附录正文不应成为文献条目。"].join("\n")
    const refs = extractReferencesFromMarkdown(md)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.title).toContain("检索增强生成综述")
  })

  it("returns nothing when there is no references section", () => {
    expect(extractReferencesFromMarkdown("# Results\nWe report gains.\n\n## Discussion\nMore prose.")).toEqual([])
  })
})
