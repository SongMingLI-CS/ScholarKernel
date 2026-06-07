import { describe, expect, it } from "vitest"

import {
  AcademicReferenceSchema,
  extractBibTeXFieldValue,
  parseBibTeX,
  parseCitations,
  parseRIS,
  serializeReferencesAsBibTeX,
} from "@/lib/utils/citation-parser"

describe("citation-parser", () => {
  it("Case 1: parses complex BibTeX with line breaks, nested braces, and and-separated authors", () => {
    const raw = `
garbage preamble text

@inproceedings{vaswani2017,
  title = {{Attention} Is {All} You Need},
  author = {Vaswani, Ashish and
    Shazeer, Noam and Jones, Niki},
  booktitle = {Proceedings of {NeurIPS}},
  year = {2017},
  doi = {10.5555/3295222.3295349}
}

trailing noise
`
    const refs = parseBibTeX(raw)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.id).toBe("vaswani2017")
    expect(refs[0]?.type).toBe("conference")
    expect(refs[0]?.title).toBe("Attention Is All You Need")
    expect(refs[0]?.authors).toEqual(["Vaswani, Ashish", "Shazeer, Noam", "Jones, Niki"])
    expect(refs[0]?.year).toBe("2017")
    expect(refs[0]?.journal).toBe("Proceedings of NeurIPS")
    expect(refs[0]?.doi).toBe("10.5555/3295222.3295349")
    expect(refs[0]?.raw).toContain("@inproceedings{vaswani2017")
  })

  it("Case 2: parses standard RIS with multiple AU tags and irregular spacing", () => {
    const raw = `   TY  - JOUR
TI  -   Attention Is All You Need
AU  - Vaswani, Ashish
AU  -   Shazeer, Noam
PY  -   2017
JO  -   NeurIPS
DO  - 10.5555/3295222.3295349
ER  - 

TY  - CONF
TI  - BERT: Pre-training of Deep Bidirectional Transformers
AU  - Devlin, Jacob
PY  - 2019
JA  - NAACL
ER  -   `
    const refs = parseRIS(raw)
    expect(refs).toHaveLength(2)
    expect(refs[0]?.title).toBe("Attention Is All You Need")
    expect(refs[0]?.authors).toEqual(["Vaswani, Ashish", "Shazeer, Noam"])
    expect(refs[0]?.year).toBe("2017")
    expect(refs[0]?.journal).toBe("NeurIPS")
    expect(refs[0]?.doi).toBe("10.5555/3295222.3295349")
    expect(refs[0]?.type).toBe("article")
    expect(refs[1]?.title).toContain("BERT")
    expect(refs[1]?.journal).toBe("NAACL")
    expect(refs[1]?.type).toBe("conference")
  })

  it("Case 3: parseCitations sandboxes dirty mixed input and extracts valid entries", () => {
    const dirty = `
<<< NOT A CITATION >>>
random log line: ERROR connection reset

@article{good2020,
  title = {Valid Paper},
  author = {Smith, Alice; Doe, Bob},
  year = {2020},
  journal = {AI Journal}
}

more garbage ~~~~

TY  - JOUR
TI  - RIS Sidecar
AU  - Lee, Amy
PY  - 2021
JO  - Nature
ER  -

<<< END >>>
`
    const refs = parseCitations(dirty)
    expect(refs.length).toBeGreaterThanOrEqual(1)
    const bib = refs.find((r) => r.id === "good2020")
    expect(bib).toBeDefined()
    expect(bib?.title).toBe("Valid Paper")
    expect(bib?.authors).toEqual(["Smith, Alice", "Doe, Bob"])
    expect(bib?.year).toBe("2020")
    expect(bib?.journal).toBe("AI Journal")
    expect(bib?.type).toBe("article")
  })

  it("extractBibTeXFieldValue handles brace nesting and escapes", () => {
    const brace = extractBibTeXFieldValue('title = {Outer {inner} tail},', 8)
    expect(brace?.value).toBe("Outer inner tail")

    const quoted = extractBibTeXFieldValue('note = "Say \\"hello\\"",', 7)
    expect(quoted?.value).toBe('Say "hello"')
  })

  it("AcademicReferenceSchema supplies defaults for missing fields", () => {
    const parsed = AcademicReferenceSchema.parse({ title: "Only Title" })
    expect(parsed.id).toBe("")
    expect(parsed.type).toBe("unknown")
    expect(parsed.authors).toEqual([])
    expect(parsed.title).toBe("Only Title")
    expect(parsed.journal).toBeNull()
    expect(parsed.doi).toBeNull()
    expect(parsed.raw).toBe("")
  })

  it("serializes references to valid BibTeX", () => {
    const refs = parseBibTeX(
      `@article{rt2022, title={Round Trip}, author={Lee, Amy and Park, Bo}, year={2022}, journal={AI Journal}}`
    )
    const bib = serializeReferencesAsBibTeX(refs)
    expect(bib).toContain("@article{rt2022,")
    expect(bib).toContain("author = {Lee, Amy and Park, Bo}")
    expect(bib).toContain("year = {2022}")
  })

  it("returns empty array for blank or unrecognizable input", () => {
    expect(parseBibTeX("")).toEqual([])
    expect(parseRIS("   ")).toEqual([])
    expect(parseCitations("not citations at all")).toEqual([])
  })
})
