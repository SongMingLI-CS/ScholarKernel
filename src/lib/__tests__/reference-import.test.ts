import { describe, expect, it, vi } from "vitest"

import { extractDoi, fetchMetadataByDoi, formatReferenceBlock } from "@/lib/reference-import"

describe("reference-import", () => {
  it("extractDoi from plain DOI string", () => {
    expect(extractDoi("10.1038/nature12373")).toBe("10.1038/nature12373")
  })

  it("extractDoi from doi.org URL", () => {
    expect(extractDoi("https://doi.org/10.1038/nature12373")).toBe("10.1038/nature12373")
  })

  it("returns null for invalid input", () => {
    expect(extractDoi("not a doi")).toBeNull()
  })

  it("fetchMetadataByDoi parses crossref response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: {
            DOI: "10.1038/nature12373",
            title: ["Sample Paper"],
            author: [{ given: "A", family: "Author" }],
            published: { "date-parts": [[2020, 1, 15]] },
            URL: "https://doi.org/10.1038/nature12373",
          },
        }),
      })
    )

    const meta = await fetchMetadataByDoi("10.1038/nature12373")
    expect(meta?.title).toBe("Sample Paper")
    expect(meta?.authors).toContain("A Author")
    expect(meta?.year).toBe(2020)
    vi.unstubAllGlobals()
  })

  it("formatReferenceBlock includes title and DOI", () => {
    const block = formatReferenceBlock({
      doi: "10.1038/nature12373",
      title: "Sample Paper",
      authors: ["A Author"],
      year: 2020,
      url: "https://doi.org/10.1038/nature12373",
    })
    expect(block).toContain("Sample Paper")
    expect(block).toContain("10.1038/nature12373")
  })
})
