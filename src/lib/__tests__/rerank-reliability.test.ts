import { afterEach, describe, expect, it, vi } from "vitest"

import { rerankAcademicHits } from "@/lib/document/rerank-gateway"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

function hit(i: number, over: Partial<AcademicSearchHit> = {}): AcademicSearchHit {
  return {
    source_id: String(i + 1),
    title: `Paper ${i} on retrieval`,
    url: `https://ex.test/${i}`,
    snippet: "dense retrieval and reranking",
    ...over,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/**
 * 回归：重排是可选增强，任何网络失败 / 超时都必须降级到词项重排，
 * 而不是让整条检索链抛出异常（历史实现没有 try/catch，fetch 抛错即全链路失败）。
 */
describe("rerank provider degradation", () => {
  it("falls back to lexical when the provider request throws", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key")
    vi.stubGlobal("fetch", () => {
      throw new Error("ECONNRESET")
    })

    const hits = Array.from({ length: 6 }, (_, i) => hit(i, { title: i === 2 ? "Transformer attention survey" : `Paper ${i}` }))
    const out = await rerankAcademicHits("transformer attention", hits, { finalTopK: 3 })

    expect(out.rerankProvider).toBe("lexical")
    expect(out.hits.length).toBe(3)
    expect(out.hits[0]?.title).toContain("Transformer")
  })

  it("falls back to lexical when the provider times out", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key")
    vi.stubEnv("RERANK_TIMEOUT_MS", "25")
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
    })

    const hits = Array.from({ length: 4 }, (_, i) => hit(i))
    const out = await rerankAcademicHits("retrieval", hits, { finalTopK: 2 })

    expect(out.rerankProvider).toBe("lexical")
    expect(out.hits).toHaveLength(2)
  })

  it("falls back to lexical when http status is not ok", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key")
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 503 }))

    const hits = Array.from({ length: 3 }, (_, i) => hit(i))
    const out = await rerankAcademicHits("retrieval", hits, { finalTopK: 2 })

    expect(out.rerankProvider).toBe("lexical")
    expect(out.hits).toHaveLength(2)
  })
})

/**
 * 回归：外部 reranker 返回越界索引时，历史实现会 spread undefined 造出
 * 只有 source_id 的空引用（title/url 全丢），并丢弃全部真实候选。
 */
describe("rerank score sanitization", () => {
  it("drops out-of-range indices instead of emitting phantom hits", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key")
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ results: [{ index: 99, relevance_score: 0.9 }, { index: 1, relevance_score: 0.5 }] })
    )

    const hits = Array.from({ length: 4 }, (_, i) => hit(i))
    const out = await rerankAcademicHits("retrieval", hits, { finalTopK: 3 })

    expect(out.hits).toHaveLength(1)
    expect(out.hits.every((h) => Boolean(h.url))).toBe(true)
    expect(out.hits[0]?.url).toBe("https://ex.test/1")
  })

  it("ignores non-finite scores and negative indices", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key")
    // 注意：JSON 无法表达 NaN（会序列化成 null），因此用非法字符串模拟“不可用分数”
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        results: [
          { index: -1, relevance_score: 0.9 },
          { index: 0, relevance_score: "not-a-number" },
          { index: 2, relevance_score: 0.4 },
        ],
      })
    )

    const hits = Array.from({ length: 4 }, (_, i) => hit(i))
    const out = await rerankAcademicHits("retrieval", hits, { finalTopK: 3 })

    expect(out.hits).toHaveLength(1)
    expect(out.hits[0]?.url).toBe("https://ex.test/2")
  })

  it("falls back to lexical when every score is unusable", async () => {
    vi.stubEnv("COHERE_API_KEY", "test-key")
    vi.stubGlobal("fetch", async () => jsonResponse({ results: [{ index: 42, relevance_score: 0.9 }] }))

    const hits = Array.from({ length: 4 }, (_, i) => hit(i))
    const out = await rerankAcademicHits("retrieval", hits, { finalTopK: 2 })

    expect(out.rerankProvider).toBe("lexical")
    expect(out.hits).toHaveLength(2)
  })
})

/**
 * 回归：召回池里同一篇论文的重复条目不应占用 Top-K 名额，也不应产生重复引用。
 */
describe("rerank candidate dedupe", () => {
  it("collapses duplicate urls before reranking", async () => {
    const hits: AcademicSearchHit[] = [
      hit(0, { url: "https://ex.test/dup", title: "Attention Is All You Need" }),
      hit(1, { url: "https://ex.test/dup", title: "Attention Is All You Need" }),
      hit(2, { url: "https://ex.test/other", title: "Unrelated cooking" }),
    ]

    const out = await rerankAcademicHits("transformer attention", hits, { finalTopK: 5 })
    const urls = out.hits.map((h) => h.url)
    expect(urls).toEqual([...new Set(urls)])
    expect(out.hits.every((h) => h.source_id === String(urls.indexOf(h.url!) + 1))).toBe(true)
  })

  it("treats titles differing only by case and spacing as the same paper", async () => {
    const hits: AcademicSearchHit[] = [
      hit(0, { url: "https://ex.test/a", title: "Attention Is All You Need" }),
      hit(1, { url: "https://ex.test/b", title: "attention  is all you need" }),
    ]

    const out = await rerankAcademicHits("attention", hits, { finalTopK: 5 })
    expect(out.hits).toHaveLength(1)
  })
})
