import type { AcademicSearchHit } from "@/lib/tools/search-tool"

export const RETRIEVAL_RECALL_TOP_K = 28
export const RERANK_FINAL_TOP_K = 5

export type RerankScore = {
  index: number
  score: number
}

const RERANK_TIMEOUT_MS = 15_000

function rerankTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(RERANK_TIMEOUT_MS)
    : undefined
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
  const tokens: string[] = []
  const segments = text.toLowerCase().match(/\p{Script=Han}+|[\p{L}\p{N}]+/gu) ?? []
  for (const segment of segments) {
    if (/^\p{Script=Han}/u.test(segment)) {
      if (segment.length === 1) tokens.push(segment)
      else {
        for (let i = 0; i < segment.length - 1; i++) tokens.push(segment.slice(i, i + 2))
      }
    } else if (segment.length > 1) {
      tokens.push(segment)
    }
  }
  return tokens
}

export type BM25CorpusStatistics = {
  documentCount: number
  totalTokenCount: number
  documentFrequency: Map<string, number>
}

export function createBM25CorpusStatistics(): BM25CorpusStatistics {
  return { documentCount: 0, totalTokenCount: 0, documentFrequency: new Map() }
}

/** Adds one bounded page to corpus-wide BM25 statistics for the supplied query. */
export function addBM25CorpusBatch(stats: BM25CorpusStatistics, query: string, docs: string[]) {
  const queryTerms = new Set(tokenize(query))
  for (const doc of docs) {
    const tokens = tokenize(doc)
    stats.documentCount++
    stats.totalTokenCount += tokens.length
    const seen = new Set(tokens)
    for (const term of queryTerms) {
      if (seen.has(term)) stats.documentFrequency.set(term, (stats.documentFrequency.get(term) ?? 0) + 1)
    }
  }
}

/** Scores a page with corpus-wide BM25 statistics so paging does not alter IDF or average length. */
export function lexicalRerankScoresAgainstCorpus(
  query: string,
  docs: string[],
  corpus: BM25CorpusStatistics,
  options: BM25Parameters = {}
): RerankScore[] {
  const qTokens = tokenize(query)
  const docTokens = docs.map((doc) => tokenize(doc))
  const N = corpus.documentCount
  const avgLen = corpus.totalTokenCount / Math.max(N, 1)
  const { k1, b } = getBM25Parameters(options)

  return docTokens.map((tokens, index) => {
    const tf = new Map<string, number>()
    for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1)
    const dl = tokens.length
    let score = 0
    for (const term of qTokens) {
      const freq = tf.get(term) ?? 0
      if (!freq) continue
      const df = corpus.documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
      const numerator = freq * (k1 + 1)
      const denominator = freq + k1 * (1 - b + (b * dl) / Math.max(avgLen, 1))
      score += idf * (numerator / denominator)
    }
    return { index, score }
  })
}

function normalizeScores(
  rows: Array<{ index: number; score: number }>,
  documentCount: number
): RerankScore[] | null {
  const seen = new Set<number>()
  const scores: RerankScore[] = []
  for (const row of rows) {
    if (!Number.isInteger(row.index) || row.index < 0 || row.index >= documentCount) continue
    if (!Number.isFinite(row.score) || seen.has(row.index)) continue
    seen.add(row.index)
    scores.push({ index: row.index, score: row.score })
  }
  return scores.length ? scores : null
}

export type BM25Parameters = { k1?: number; b?: number }

function configuredBm25Number(name: string, fallback: number, min: number, max: number): number {
  const configured = Number(safeEnv(name))
  return Number.isFinite(configured) && configured >= min && configured <= max ? configured : fallback
}

export function getBM25Parameters(overrides: BM25Parameters = {}): Required<BM25Parameters> {
  const k1 = overrides.k1 ?? configuredBm25Number("RAG_BM25_K1", 1.2, 0, 3)
  const b = overrides.b ?? configuredBm25Number("RAG_BM25_B", 0.75, 0, 1)
  return {
    k1: Number.isFinite(k1) && k1 >= 0 && k1 <= 3 ? k1 : 1.2,
    b: Number.isFinite(b) && b >= 0 && b <= 1 ? b : 0.75,
  }
}

/** BM25 scoring with Chinese adjacent-character bigrams and configurable k1/b. */
export function lexicalRerankScores(query: string, docs: string[], options: BM25Parameters = {}): RerankScore[] {
  const corpus = createBM25CorpusStatistics()
  addBM25CorpusBatch(corpus, query, docs)
  return lexicalRerankScoresAgainstCorpus(query, docs, corpus, options)
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
    signal: rerankTimeoutSignal(),
  })
  if (!res.ok) return null

  const data = (await res.json()) as { results?: Array<{ index: number; relevance_score: number }> }
  if (!Array.isArray(data.results)) return null
  return normalizeScores(data.results.map((r) => ({ index: r.index, score: r.relevance_score })), docs.length)
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
    signal: rerankTimeoutSignal(),
  })
  if (!res.ok) return null

  const data = (await res.json()) as {
    results?: Array<{ index: number; score?: number; relevance_score?: number }>
    scores?: number[]
  }

  if (Array.isArray(data.results)) {
    return normalizeScores(data.results.map((r) => ({
      index: r.index,
      score: r.score ?? r.relevance_score ?? 0,
    })), docs.length)
  }
  if (Array.isArray(data.scores) && data.scores.length === docs.length) {
    return normalizeScores(data.scores.map((score, index) => ({ index, score })), docs.length)
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
  rerankProvider: "local-http" | "cohere" | "bge-http" | "lexical"
  scores?: RerankScore[]
}

export type LocalRerankResult = {
  model: string
  revision: string
  scores: RerankScore[]
}

/** Calls an explicitly configured local reranker and checks its model identity. */
export async function rerankWithLocalService(query: string, docs: string[]): Promise<LocalRerankResult | null> {
  const url = safeEnv("LOCAL_RERANKER_API_URL")
  const model = safeEnv("LOCAL_RERANKER_MODEL")
  const revision = safeEnv("LOCAL_RERANKER_REVISION")
  if (!url || !model || !revision || docs.length === 0) return null

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, revision, query, documents: docs }),
    signal: rerankTimeoutSignal(),
  })
  if (!response.ok) return null
  const body = await response.json() as {
    model?: unknown
    revision?: unknown
    results?: Array<{ index: number; score?: number; relevance_score?: number }>
    scores?: number[]
  }
  if (body.model !== model || body.revision !== revision) return null
  const scores = Array.isArray(body.results)
    ? normalizeScores(body.results.map((row) => ({ index: row.index, score: row.score ?? row.relevance_score ?? Number.NaN })), docs.length)
    : Array.isArray(body.scores) && body.scores.length === docs.length
      ? normalizeScores(body.scores.map((score, index) => ({ index, score })), docs.length)
      : null
  return scores ? { model, revision, scores } : null
}

/**
 * 二级重排网关：宽召回 → 精筛 Top-K。
 * 优先本地 HTTP / Cohere / BGE HTTP；服务不可用时降级为 BM25 风格词项重排。
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
  let scores: RerankScore[] | null = null
  let provider: RerankGatewayResult["rerankProvider"] = "local-http"
  let rerankerModel: string | undefined

  try {
    const local = await rerankWithLocalService(query, docs)
    if (local) {
      scores = local.scores
      rerankerModel = `${local.model}@${local.revision}`
    }
  } catch {
    scores = null
  }

  if (!scores) {
    try {
      scores = await cohereRerank(query, docs)
    } catch {
      scores = null
    }
    provider = "cohere"
  }

  if (!scores) {
    try {
      scores = await bgeRerankViaHttp(query, docs)
    } catch {
      scores = null
    }
    provider = "bge-http"
  }
  if (!scores) {
    scores = lexicalRerankScores(query, docs)
    provider = "lexical"
  }

  const ranked = [...scores]
    .filter((score) => Number.isInteger(score.index) && score.index >= 0 && score.index < recall.length && Number.isFinite(score.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, finalTopK)
  const reranked = ranked.map((r, idx) => ({
    ...recall[r.index]!,
    source_id: String(idx + 1),
    rerankScore: r.score,
    ...(rerankerModel
      ? { rerankerModel }
      : safeEnv("RERANK_MODEL")
        ? { rerankerModel: safeEnv("RERANK_MODEL") }
        : provider === "cohere"
          ? { rerankerModel: "rerank-english-v3.0" }
          : {}),
  }))

  return {
    hits: reranked,
    recallCount: recall.length,
    rerankProvider: provider,
    scores: ranked,
  }
}
