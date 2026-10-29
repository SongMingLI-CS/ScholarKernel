import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { lexicalRerankScores, rerankAcademicHits } from "@/lib/document/rerank-gateway"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

describe("rerankAcademicHits", () => {
  beforeEach(() => {
    vi.stubEnv("COHERE_API_KEY", "")
    vi.stubEnv("RERANK_API_URL", "")
    vi.stubEnv("RERANK_API_KEY", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

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

  it("uses Chinese bigrams to distinguish relevant documents", () => {
    const scores = lexicalRerankScores("学术文献检索", [
      "学术文献检索方法与排序研究",
      "机器设备维修手册",
    ])
    expect(scores[0]?.score).toBeGreaterThan(scores[1]?.score ?? 0)
    expect(scores[1]?.score).toBe(0)
  })

  it("falls back to lexical ranking when both configured services throw", async () => {
    vi.stubEnv("COHERE_API_KEY", "synthetic-test-key")
    vi.stubEnv("RERANK_API_URL", "https://reranker.invalid/test")
    vi.stubEnv("RERANK_API_KEY", "synthetic-test-key")
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection unavailable")))

    const out = await rerankAcademicHits("transformer attention", [
      { source_id: "1", title: "Relevant attention transformer", url: "https://example.test/relevant" },
      { source_id: "2", title: "Unrelated recipes", url: "https://example.test/other" },
    ])

    expect(out.rerankProvider).toBe("lexical")
    expect(out.hits[0]?.title).toContain("attention")
  })

  it("ignores invalid external indexes and uses the lexical fallback", async () => {
    vi.stubEnv("COHERE_API_KEY", "synthetic-test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ index: 99, relevance_score: 0.9 }],
    }), { status: 200, headers: { "content-type": "application/json" } })))

    const out = await rerankAcademicHits("transformer", [
      { source_id: "1", title: "Transformer paper", url: "https://example.test/paper" },
      { source_id: "2", title: "Cooking recipe", url: "https://example.test/recipe" },
    ])

    expect(out.rerankProvider).toBe("lexical")
    expect(out.hits[0]?.title).toContain("Transformer")
  })

  it("uses valid Cohere results and preserves the returned ranking", async () => {
    vi.stubEnv("COHERE_API_KEY", "synthetic-test-key")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }],
    }), { status: 200, headers: { "content-type": "application/json" } })))

    const out = await rerankAcademicHits("query", [
      { source_id: "1", title: "First", url: "https://example.test/first" },
      { source_id: "2", title: "Second", url: "https://example.test/second" },
    ])

    expect(out.rerankProvider).toBe("cohere")
    expect(out.hits.map((hit) => hit.title)).toEqual(["Second", "First"])
  })
})
