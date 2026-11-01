import type { AcademicSearchHit } from "@/lib/tools/search-tool"

export const RETRIEVAL_RECALL_TOP_K = 28
export const RERANK_FINAL_TOP_K = 5
export const DEFAULT_RERANK_TIMEOUT_MS = 8000

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

/**
 * CJK 连续段（含假名）。中文/日文没有词间空格，按空白切词会把整句变成**一个** token，
 * 查询与文档几乎永不相等，词项重排直接失效。
 */
const CJK_RUN = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff"
const CJK_SPLIT_RE = new RegExp(`([${CJK_RUN}]+)`)
const CJK_ONLY_RE = new RegExp(`^[${CJK_RUN}]+$`)

/**
 * 中文没有空格，用**二元组（bigram）**近似切词：`深度学习` -> `深度 / 度学 / 学习`。
 * 这是无词典分词里最省事、召回也够的做法；单字段落仍产出该单字。
 */
function cjkBigrams(run: string): string[] {
  const chars = Array.from(run)
  if (chars.length === 1) return [chars[0]!]
  const out: string[] = []
  for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i]! + chars[i + 1]!)
  return out
}

function tokenize(text: string): string[] {
  const lowered = text.toLowerCase()
  const out: string[] = []
  // 先把 CJK 段与其余部分切开，各走各的规则
  for (const part of lowered.split(CJK_SPLIT_RE)) {
    if (!part) continue
    if (CJK_ONLY_RE.test(part)) {
      out.push(...cjkBigrams(part))
      continue
    }
    for (const t of part.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/)) {
      if (t.length > 1) out.push(t)
    }
  }
  return out
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

function rerankTimeoutMs(): number {
  const raw = Number.parseInt(safeEnv("RERANK_TIMEOUT_MS"), 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RERANK_TIMEOUT_MS
}

/**
 * 外部 reranker 是可选增强层：任何异常、超时或响应格式异常都必须降级到下一级，
 * 不能把整条检索链一起拖死。
 */
async function requestRerankScores(
  label: string,
  docsCount: number,
  fn: (signal: AbortSignal) => Promise<RerankScore[] | null>
): Promise<RerankScore[] | null> {
  const signal = AbortSignal.timeout(rerankTimeoutMs())
  try {
    return sanitizeRerankScores(await fn(signal), docsCount)
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}:${e.message}` : String(e)
    console.warn(`[rerank-gateway] ${label} failed, degrading to next provider (${msg})`)
    return null
  }
}

/** 丢弃越界索引、重复索引与非有限分数，避免下游 spread 出空引用。 */
export function sanitizeRerankScores(
  scores: RerankScore[] | null | undefined,
  docsCount: number
): RerankScore[] | null {
  if (!Array.isArray(scores) || scores.length === 0) return null
  const seen = new Set<number>()
  const out: RerankScore[] = []
  for (const s of scores) {
    if (!s || typeof s !== "object") continue
    const index = Number(s.index)
    const score = Number(s.score)
    if (!Number.isInteger(index) || index < 0 || index >= docsCount) continue
    if (!Number.isFinite(score)) continue
    if (seen.has(index)) continue
    seen.add(index)
    out.push({ index, score })
  }
  return out.length ? out : null
}

async function cohereRerank(query: string, docs: string[], signal: AbortSignal): Promise<RerankScore[] | null> {
  const apiKey = safeEnv("COHERE_API_KEY")
  if (!apiKey || docs.length === 0) return null

  const res = await fetch("https://api.cohere.com/v1/rerank", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
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

async function bgeRerankViaHttp(query: string, docs: string[], signal: AbortSignal): Promise<RerankScore[] | null> {
  const url = safeEnv("RERANK_API_URL")
  const apiKey = safeEnv("RERANK_API_KEY")
  if (!url || docs.length === 0) return null

  const headers: Record<string, string> = { "content-type": "application/json" }
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  const res = await fetch(url, {
    method: "POST",
    headers,
    signal,
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

function normalizeKeyPart(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim()
}

/** 只影响归因、不影响内容的参数。留着它们会让同一页被当成不同文献。 */
const TRACKING_PARAM_RE = /^(?:utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$|source$|spm$|share$)/

/**
 * URL 归一化键。
 *
 * 同一篇论文会被多路检索以不同形态召回：`#abstract` 锚点、结尾斜杠、
 * `?utm_source=…` 追踪参数、`http` vs `https`。只做小写化的话这些全是「不同文献」，
 * 于是同一篇论文占满重排预算，把真正的新结果挤掉（`recallCount` 看着很高，
 * 实际去重后只剩一半语义覆盖）。
 *
 * 保守起见只归一「确定不影响内容」的维度：fragment、追踪参数、结尾斜杠、协议与
 * host 大小写。查询串里的其他参数保持原样 —— `?v=1` 与 `?v=2` 可能是不同版本。
 */
export function canonicalUrlKey(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim()
  if (!trimmed) return ""
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    // 非法 URL（检索结果里确实存在）：退化成字符串比较，至少不会漏掉完全相同的串
    return normalizeKeyPart(trimmed)
  }

  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM_RE.test(key.toLowerCase()))
  const search = kept.length ? new URLSearchParams(kept).toString() : ""
  const pathname = url.pathname.replace(/\/+$/, "")
  // 主机名大小写不敏感；协议按 https 归一（学术检索里 http/https 指向同一份文档）
  return `https://${url.hostname.toLowerCase()}${pathname}${search ? `?${search}` : ""}`
}

/** 同一篇文献可能以不同 URL / 大小写标题多次召回：url 或归一化标题任一相同即视为重复。 */
export function dedupeAcademicHits(hits: AcademicSearchHit[]): AcademicSearchHit[] {
  const seenUrls = new Set<string>()
  const seenTitles = new Set<string>()
  const out: AcademicSearchHit[] = []
  for (const h of hits) {
    const url = canonicalUrlKey(h.url)
    const title = normalizeKeyPart(h.title)
    if (url && seenUrls.has(url)) continue
    if (title && seenTitles.has(title)) continue
    if (url) seenUrls.add(url)
    if (title) seenTitles.add(title)
    out.push(h)
  }
  return out
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
  // 去重放在召回侧：重复条目不应占用 Top-K 名额，也不应产生重复引用
  const recall = dedupeAcademicHits(hits).slice(0, recallLimit)
  if (recall.length === 0) {
    return { hits: [], recallCount: 0, rerankProvider: "lexical" }
  }

  const docs = recall.map(hitToRerankDoc)
  let scores = await requestRerankScores("cohere", docs.length, (signal) => cohereRerank(query, docs, signal))
  let provider: RerankGatewayResult["rerankProvider"] = "cohere"

  if (!scores) {
    scores = await requestRerankScores("bge-http", docs.length, (signal) => bgeRerankViaHttp(query, docs, signal))
    provider = "bge-http"
  }
  if (!scores) {
    scores = sanitizeRerankScores(lexicalRerankScores(query, docs), docs.length)
    provider = "lexical"
  }
  if (!scores) {
    // 词项重排全零分（例如查询词全被过滤）时，保留原始召回顺序而不是返回空结果
    const fallback = recall.slice(0, finalTopK).map((h, idx) => ({ ...h, source_id: String(idx + 1) }))
    return { hits: fallback, recallCount: recall.length, rerankProvider: "lexical" }
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
