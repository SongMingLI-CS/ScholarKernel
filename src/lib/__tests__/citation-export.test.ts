import { describe, expect, it } from "vitest"

import { collectCitationSources, exportSourcesAsBibTeX, exportSourcesAsRIS } from "@/lib/citation-export"

const sample = [
  { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", publishedAt: "2017" },
  { title: "BERT", url: "https://doi.org/10.18653/v1/N19-1423", snippet: "Pre-training" },
]

describe("citation-export", () => {
  it("exports BibTeX entries with keys and urls", () => {
    const sources = collectCitationSources(sample)
    const bib = exportSourcesAsBibTeX(sources)
    expect(bib).toContain("@misc{")
    expect(bib).toContain("Attention Is All You Need")
    expect(bib).toContain("url = {https://arxiv.org/abs/1706.03762}")
  })

  it("exports RIS records", () => {
    const sources = collectCitationSources(sample)
    const ris = exportSourcesAsRIS(sources)
    expect(ris).toContain("TY  - GEN")
    expect(ris).toContain("TI  - Attention Is All You Need")
    expect(ris).toContain("ER  -")
  })

  it("deduplicates by url", () => {
    const sources = collectCitationSources([
      ...sample,
      { title: "dup", url: "https://arxiv.org/abs/1706.03762" },
    ])
    expect(sources).toHaveLength(2)
  })
})
