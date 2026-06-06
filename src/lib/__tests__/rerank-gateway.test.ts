import { describe, expect, it } from "vitest"

import { rerankAcademicHits } from "@/lib/document/rerank-gateway"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

describe("rerankAcademicHits", () => {
  it("narrows recall pool to final top-k", async () => {
    const hits: AcademicSearchHit[] = Array.from({ length: 12 }, (_, i) => ({
      source_id: String(i + 1),
      title: i === 3 ? "Transformer attention for NLP" : `Paper ${i}`,
      url: `https://ex.test/${i}`,
      snippet: i === 3 ? "Self-attention mechanism in transformers" : "Unrelated topic",
    }))

    const out = await rerankAcademicHits("transformer attention NLP", hits, {
      recallLimit: 12,
      finalTopK: 5,
    })

    expect(out.recallCount).toBe(12)
    expect(out.hits).toHaveLength(5)
    expect(out.hits[0]?.title).toContain("Transformer")
    expect(out.hits[0]?.source_id).toBe("1")
  })
})
