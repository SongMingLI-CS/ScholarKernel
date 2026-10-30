import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  addBM25CorpusBatch,
  createBM25CorpusStatistics,
  getBM25Parameters,
  lexicalRerankScores,
  lexicalRerankScoresAgainstCorpus,
  rerankAcademicHits,
  rerankWithLocalService,
} from "@/lib/document/rerank-gateway"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

describe("rerankAcademicHits", () => {
  beforeEach(() => {
    vi.stubEnv("COHERE_API_KEY", "")
    vi.stubEnv("RERANK_API_URL", "")
    vi.stubEnv("RERANK_API_KEY", "")
    vi.stubEnv("LOCAL_RERANKER_API_URL", "")
    vi.stubEnv("LOCAL_RERANKER_MODEL", "")
    vi.stubEnv("LOCAL_RERANKER_REVISION", "")
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

  it("keeps corpus-wide BM25 statistics unchanged across bounded pages", () => {
    const query = "跨学科检索质量"
    const docs = [
      "跨学科研究检索质量评估与语义证据",
      "跨学科研究的另一种检索质量比较",
      "材料科学的实验结果与误差分析",
      "检索质量和语义证据的相关性研究",
    ]
    const expected = lexicalRerankScores(query, docs)
    const corpus = createBM25CorpusStatistics()
    addBM25CorpusBatch(corpus, query, docs.slice(0, 2))
    addBM25CorpusBatch(corpus, query, docs.slice(2))
    const firstPage = lexicalRerankScoresAgainstCorpus(query, docs.slice(0, 2), corpus)
    const secondPage = lexicalRerankScoresAgainstCorpus(query, docs.slice(2), corpus)

    expect(firstPage.map((row) => row.score)).toEqual(expected.slice(0, 2).map((row) => row.score))
    expect(secondPage.map((row) => row.score)).toEqual(expected.slice(2).map((row) => row.score))
  })

  it("uses explicit and environment BM25 k1/b values within supported bounds", () => {
    vi.stubEnv("RAG_BM25_K1", "1.8")
    vi.stubEnv("RAG_BM25_B", "0.4")
    expect(getBM25Parameters()).toEqual({ k1: 1.8, b: 0.4 })
    expect(getBM25Parameters({ k1: 2.1, b: 0.2 })).toEqual({ k1: 2.1, b: 0.2 })
    expect(getBM25Parameters({ k1: 99, b: -1 })).toEqual({ k1: 1.2, b: 0.75 })
    expect(lexicalRerankScores("academic search", ["academic research search", "unrelated topic"], { k1: 1.8, b: 0.4 })[0]?.score)
      .toBeGreaterThan(0)
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

  it("prefers the explicitly configured local reranker and records its exact version", async () => {
    vi.stubEnv("LOCAL_RERANKER_API_URL", "http://127.0.0.1:8999/v1/rerank")
    vi.stubEnv("LOCAL_RERANKER_MODEL", "cross-encoder/ms-marco-MiniLM-L6-v2")
    vi.stubEnv("LOCAL_RERANKER_REVISION", "fbf9045f293a58fa68636213c5e0cb8a2de5d45e")
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "cross-encoder/ms-marco-MiniLM-L6-v2",
      revision: "fbf9045f293a58fa68636213c5e0cb8a2de5d45e",
      results: [{ index: 1, score: 0.8 }, { index: 0, score: -0.2 }],
    }), { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)

    const out = await rerankAcademicHits("query", [
      { source_id: "1", title: "First", url: "https://example.test/first" },
      { source_id: "2", title: "Second", url: "https://example.test/second" },
    ])

    expect(out.rerankProvider).toBe("local-http")
    expect(out.hits.map((hit) => hit.title)).toEqual(["Second", "First"])
    expect(out.hits[0]?.rerankerModel).toBe("cross-encoder/ms-marco-MiniLM-L6-v2@fbf9045f293a58fa68636213c5e0cb8a2de5d45e")
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8999/v1/rerank")
  })

  it("rejects local reranker output with a different pinned model revision", async () => {
    vi.stubEnv("LOCAL_RERANKER_API_URL", "http://127.0.0.1:8999/v1/rerank")
    vi.stubEnv("LOCAL_RERANKER_MODEL", "cross-encoder/local")
    vi.stubEnv("LOCAL_RERANKER_REVISION", "expected-revision")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "cross-encoder/local",
      revision: "different-revision",
      results: [{ index: 1, score: 0.8 }],
    }), { status: 200, headers: { "content-type": "application/json" } })))

    await expect(rerankWithLocalService("query", ["document"])).resolves.toBeNull()
  })
})
