import type { AcademicSearchHit } from "@/lib/tools/search-tool"

export const RETRIEVAL_RECALL_TOP_K = 28
export const RERANK_FINAL_TOP_K = 5

export type RerankScore = {
  index: number
  score: number
}

function safeEnv(name: string): string {
  try {
    const v = (process.env as Record<string, string | undefined> | undefined)?.[name]
    return typeof v === "string" ? v.trim() : ""
  } catch {
    return ""
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

/** BM25 风格轻量词项打分（无外部 API 时的兜底重排）。 */
export function lexicalRerankScores(query: string, docs: string[]): RerankScore[] {
  const qTokens = tokenize(query)
  const docTokens = docs.map((d) => tokenize(d))
  const N = docs.length
  const avgLen = docTokens.reduce((s, t) => s + t.length, 0) / Math.max(N, 1)
  const k1 = 1.2
  const b = 0.75

  const df = new Map<string, number>()
  for (const tokens of docTokens) {
    const seen = new Set(tokens)
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1)
  }

  return docTokens.map((tokens, index) => {
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1)
    const dl = tokens.length

    let score = 0
    for (const qt of qTokens) {
      const freq = tf.get(qt) ?? 0
      if (!freq) continue
      const idf = Math.log(1 + (N - (df.get(qt) ?? 0) + 0.5) / ((df.get(qt) ?? 0) + 0.5))
      const num = freq * (k1 + 1)
      const den = freq + k1 * (1 - b + (b * dl) / Math.max(avgLen, 1))
      score += idf * (num / den)
    }
    return { index, score }
  })
}

async function cohereRerank(query: string, docs: string[]): Promise<RerankScore[] | null> {
  const apiKey = safeEnv("COHERE_API_KEY")
  if (!apiKey || docs.length === 0) return null

  const res = await fetch("https://api.cohere.com/v1/rerank", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "rerank-english-v3.0",
      query,
      documents: docs,
      top_n: Math.min(docs.length, RETRIEVAL_RECALL_TOP_K),
    }),
  })
  if (!res.ok) return null

  const data = (await res.json()) as { results?: Array<{ index: number; relevance_score: number }> }
  if (!Array.isArray(data.results)) return null
  return data.results.map((r) => ({ index: r.index, score: r.relevance_score }))
}

async function bgeRerankViaHttp(query: string, docs: string[]): Promise<RerankScore[] | null> {
  const url = safeEnv("RERANK_API_URL")
  const apiKey = safeEnv("RERANK_API_KEY")
  if (!url || docs.length === 0) return null

  const headers: Record<string, string> = { "content-type": "application/json" }
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: safeEnv("RERANK_MODEL") || "BAAI/bge-reranker-large",
      query,
      documents: docs,
    }),
  })
  if (!res.ok) return null

  const data = (await res.json()) as {
    results?: Array<{ index: number; score?: number; relevance_score?: number }>
    scores?: number[]
  }

  if (Array.isArray(data.results)) {
    return data.results.map((r) => ({
      index: r.index,
      score: r.score ?? r.relevance_score ?? 0,
    }))
  }
  if (Array.isArray(data.scores) && data.scores.length === docs.length) {
    return data.scores.map((score, index) => ({ index, score }))
  }
  return null
}

function hitToRerankDoc(hit: AcademicSearchHit): string {
  const parts = [hit.title, hit.snippet ?? "", hit.url].filter(Boolean)
  return parts.join("\n")
}

export type RerankGatewayResult = {
  hits: AcademicSearchHit[]
  recallCount: number
  rerankProvider: "cohere" | "bge-http" | "lexical"
  scores?: RerankScore[]
}

/**
 * 二级重排网关：宽召回 → 精筛 Top-K。
 * 优先 Cohere / BGE HTTP；无密钥时降级为 BM25 风格词项重排。
 */
export async function rerankAcademicHits(
  query: string,
  hits: AcademicSearchHit[],
  opts?: { finalTopK?: number; recallLimit?: number }
): Promise<RerankGatewayResult> {
  const recallLimit = opts?.recallLimit ?? RETRIEVAL_RECALL_TOP_K
  const finalTopK = opts?.finalTopK ?? RERANK_FINAL_TOP_K
  const recall = hits.slice(0, recallLimit)
  if (recall.length === 0) {
    return { hits: [], recallCount: 0, rerankProvider: "lexical" }
  }

  const docs = recall.map(hitToRerankDoc)
  let scores: RerankScore[] | null = await cohereRerank(query, docs)
  let provider: RerankGatewayResult["rerankProvider"] = "cohere"

  if (!scores) {
    scores = await bgeRerankViaHttp(query, docs)
    provider = "bge-http"
  }
  if (!scores) {
    scores = lexicalRerankScores(query, docs)
    provider = "lexical"
  }

  const ranked = [...scores].sort((a, b) => b.score - a.score).slice(0, finalTopK)
  const reranked = ranked.map((r, idx) => ({
    ...recall[r.index]!,
    source_id: String(idx + 1),
  }))

  return {
    hits: reranked,
    recallCount: recall.length,
    rerankProvider: provider,
    scores: ranked,
  }
}
