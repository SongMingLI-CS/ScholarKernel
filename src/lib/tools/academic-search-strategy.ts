import type { AcademicSearchHit, AcademicSearchResponse } from "@/lib/tools/search-tool"
import {
  RERANK_FINAL_TOP_K,
  RETRIEVAL_RECALL_TOP_K,
} from "@/lib/document/rerank-gateway"

/** 第一阶段宽召回 TopK（Tavily advanced） */
export const DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS = RETRIEVAL_RECALL_TOP_K

/** 第二阶段重排后写入上下文的精选条数 */
export { RERANK_FINAL_TOP_K, RETRIEVAL_RECALL_TOP_K }

/** 单条摘要写入上下文时的最大字符数（仅截断 snippet，不截断 title/url） */
export const DEFAULT_SNIPPET_CONTEXT_CHARS = 480

const BROAD_TOPIC_RE =
  /\b(LLM|large language model|GPT|transformer|computer vision|NLP|deep learning|machine learning|reinforcement learning|diffusion|multimodal|agent|foundation model)\b/i

const SURVEY_PROGRESS_RE =
  /综述|文献综述|研究进展|核心进展|发展现状|前沿|最新进展|state[\s-]?of[\s-]?the[\s-]?art|survey|review\s+paper|literature\s+review|research\s+progress|recent\s+advances|overview/i

export function truncateSnippet(text: string, maxChars: number): string {
  const t = text.trim()
  if (!maxChars || t.length <= maxChars) return t
  return `${t.slice(0, maxChars)}…`
}

/** 宽泛主题：短 query、无具体论文标题、或命中常见领域词 */
export function isBroadTopicQuery(draftQuery: string, userInput?: string): boolean {
  const q = draftQuery.trim()
  if (!q) return false
  if (q.length > 120) return false
  if (/\barxiv:\d{4}\.\d{4,5}\b/i.test(q)) return false
  if (/full paper|doi:|10\.\d{4,}\//i.test(q)) return false
  if (BROAD_TOPIC_RE.test(q)) return true
  const u = (userInput ?? "").trim()
  if (u && BROAD_TOPIC_RE.test(u) && q.split(/\s+/).length <= 14) return true
  return q.split(/\s+/).length <= 6 && /research|papers|survey|latest|recent/i.test(q)
}

export function isSurveyOrProgressTopic(text: string): boolean {
  return SURVEY_PROGRESS_RE.test(text.trim())
}

/** 从 query / 用户输入提取核心主题词（用于扩写） */
export function extractResearchTopic(userInput: string, draftQuery?: string): string {
  const q = (draftQuery ?? "").trim()
  const u = userInput.trim()

  for (const src of [q, u]) {
    const m = src.match(
      /\b((?:large language models?|LLMs?|computer vision|natural language processing|deep learning|machine learning|reinforcement learning|diffusion models?|multimodal|foundation models?|Mamba|Transformer))\b/i
    )
    if (m?.[1]) return m[1]
  }

  const cnMap: Array<[RegExp, string]> = [
    [/大语言模型|语言模型|LLM/i, "large language models"],
    [/计算机视觉|视觉/i, "computer vision"],
    [/自然语言|NLP/i, "natural language processing"],
    [/深度学习/i, "deep learning"],
    [/机器学习/i, "machine learning"],
    [/强化学习/i, "reinforcement learning"],
  ]
  for (const [re, en] of cnMap) {
    if (re.test(u) || re.test(q)) return en
  }

  const cleaned = (q || u)
    .replace(/[\u4e00-\u9fff]+/g, " ")
    .replace(/\b(survey|review|research|papers|arxiv|latest|recent|202[4-6])\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (cleaned.length >= 3 && cleaned.length <= 80) return cleaned
  return "AI research"
}

/**
 * 关键词多样化：宽泛主题 → 多组英文检索式，供并行分批检索。
 */
export function expandSearchQueries(userInput: string, draftQuery: string): string[] {
  const topic = extractResearchTopic(userInput, draftQuery)
  const yearSpan = "2024 2025 2026"
  return [
    `Recent ${topic} survey ${yearSpan} arxiv`,
    `State-of-the-art ${topic} architectures research papers`,
    `Core ${topic} research papers ${yearSpan} arxiv`,
  ]
}

/** 综述类 / 核心进展类：双路检索（Survey + Methodology） */
export function resolveResearchQueryList(
  payload: Record<string, unknown>,
  draftQuery: string,
  userInput: string
): string[] {
  const fromPlanner = payload["search_queries"]
  if (Array.isArray(fromPlanner) && fromPlanner.length) {
    return fromPlanner.map((q) => String(q).trim()).filter(Boolean).slice(0, 4)
  }
  if (isBroadTopicQuery(draftQuery, userInput)) {
    return expandSearchQueries(userInput, draftQuery)
  }
  return [draftQuery.trim()].filter(Boolean)
}

export function buildDualSearchQueries(userInput: string, draftQuery?: string): [string, string] {
  const topic = extractResearchTopic(userInput, draftQuery)
  return [
    `${topic} survey review literature ${draftQuery?.includes("202") ? "" : "2024 2025 2026 "}arxiv`,
    `${topic} state-of-the-art core models methodology architecture research papers arxiv`,
  ]
}

export function formatResearchHitLines(
  results: AcademicSearchHit[],
  snippetMaxChars = DEFAULT_SNIPPET_CONTEXT_CHARS
): string[] {
  return results.map((r, i) => {
    const sid = r.source_id?.trim() ? r.source_id.trim() : String(i + 1)
    const snippet = r.snippet?.trim()
      ? `\n   摘要: ${truncateSnippet(r.snippet, snippetMaxChars)}`
      : ""
    return `[${sid}] ${r.title} (${r.url})${snippet}`
  })
}

export function formatResearchResultsForContext(
  out: Pick<AcademicSearchResponse, "query" | "total" | "status" | "results">,
  citationsMarkdown: string,
  snippetMaxChars = DEFAULT_SNIPPET_CONTEXT_CHARS
): string {
  const refLines = formatResearchHitLines(out.results ?? [], snippetMaxChars)
  return [
    "【academicSearch 工具结果 — 已同步至会话上下文】",
    `query: ${out.query}`,
    `total: ${out.total}`,
    `status: ${out.status}`,
    "",
    "检索到的文献摘要 (tool result / references):",
    ...refLines,
    citationsMarkdown ? ["", citationsMarkdown].join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n")
}

export function mergeAcademicSearchHits(
  existing: AcademicSearchHit[],
  incoming: AcademicSearchHit[]
): AcademicSearchHit[] {
  const seen = new Set<string>()
  const merged: AcademicSearchHit[] = []

  for (const r of [...existing, ...incoming]) {
    const url = r.url?.trim()
    const key = normalizeAcademicUrlKey(url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push({ ...r, source_id: "" })
  }

  return merged.map((r, idx) => ({ ...r, source_id: String(idx + 1) }))
}

function normalizeAcademicUrlKey(raw: string | undefined): string {
  if (!raw) return ""
  try {
    const url = new URL(raw)
    url.hash = ""
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key)
    }
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "")
    url.searchParams.sort()
    return url.toString()
  } catch {
    return raw.trim()
  }
}

/** Reciprocal-rank fusion for results returned by independent queries or local/web retrievers. */
export function fuseAcademicSearchHits(rankings: AcademicSearchHit[][], limit = 24): AcademicSearchHit[] {
  const fused = new Map<string, { hit: AcademicSearchHit; score: number; bestRank: number }>()
  const rankConstant = 60
  for (const ranking of rankings) {
    ranking.forEach((hit, index) => {
      const key = normalizeAcademicUrlKey(hit.url)
      if (!key) return
      const contribution = 1 / (rankConstant + index + 1)
      const current = fused.get(key)
      if (current) {
        current.score += contribution
        const preferred = index < current.bestRank ? hit : current.hit
        current.hit = {
          ...preferred,
          ...(current.hit.retrievalScore !== undefined || hit.retrievalScore !== undefined
            ? { retrievalScore: current.hit.retrievalScore ?? hit.retrievalScore } : {}),
          ...(current.hit.denseScore !== undefined || hit.denseScore !== undefined
            ? { denseScore: current.hit.denseScore ?? hit.denseScore } : {}),
          ...(current.hit.rerankScore !== undefined || hit.rerankScore !== undefined
            ? { rerankScore: current.hit.rerankScore ?? hit.rerankScore } : {}),
        }
        if (index < current.bestRank) {
          current.bestRank = index
        }
      } else {
        fused.set(key, { hit, score: contribution, bestRank: index })
      }
    })
  }
  return [...fused.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[1].bestRank - b[1].bestRank || a[0].localeCompare(b[0]))
    .slice(0, Math.max(0, limit))
    .map(([, item], index) => ({ ...item.hit, source_id: String(index + 1), fusionScore: item.score }))
}

/** Merge a new search batch and reassign each result to the global citation ID. */
export function reconcileAcademicSearchSources(
  existing: AcademicSearchHit[],
  incoming: AcademicSearchHit[]
): { sources: AcademicSearchHit[]; results: AcademicSearchHit[] } {
  const sources = mergeAcademicSearchHits(existing, incoming)
  const idByUrl = new Map(sources.map((hit) => [normalizeAcademicUrlKey(hit.url), hit.source_id]))
  const seen = new Set<string>()
  const results: AcademicSearchHit[] = []
  for (const hit of incoming) {
    const key = normalizeAcademicUrlKey(hit.url)
    const sourceId = idByUrl.get(key)
    if (!key || !sourceId || seen.has(key)) continue
    seen.add(key)
    results.push({ ...hit, source_id: sourceId })
  }
  return { sources, results }
}

export function mergeAcademicSearchResponses(
  responses: AcademicSearchResponse[],
  combinedQuery: string
): AcademicSearchResponse {
  if (!responses.length) {
    return {
      provider: "tavily",
      query: combinedQuery,
      academicOnly: true,
      total: 0,
      results: [],
      status: "failed",
      message: "无检索响应",
    }
  }

  const mergedHits = fuseAcademicSearchHits(responses.map((response) => response.results ?? []))
  const anyOk = responses.some((r) => r.status === "ok" && (r.results?.length ?? 0) > 0)
  const allFailed = responses.every((r) => r.status === "failed")
  const academicOnly = responses.every((r) => r.academicOnly)

  let status: AcademicSearchResponse["status"] = "ok"
  let message: string | undefined

  if (mergedHits.length === 0) {
    if (allFailed) {
      status = "failed"
      message = responses.find((r) => r.message)?.message
    } else {
      status = "empty"
      message = responses.find((r) => r.message)?.message
    }
  } else if (!anyOk && mergedHits.length > 0) {
    status = "ok"
  }

  return {
    provider: responses[0]!.provider,
    query: combinedQuery,
    academicOnly,
    total: mergedHits.length,
    results: mergedHits,
    status,
    ...(message ? { message } : {}),
  }
}

/** 可按调用方需要省去引用详情，避免与单独的引用区重复占用上下文。 */
export function serializeResearchOutputForReasoning(
  output: Record<string, unknown>,
  options?: { includeCitationDetails?: boolean }
) {
  const results = Array.isArray(output["results"]) ? (output["results"] as AcademicSearchHit[]) : []
  const references = results.map((r, i) => {
    const sid = r.source_id?.trim() ? r.source_id.trim() : String(i + 1)
    return {
      source_id: sid,
      ...(options?.includeCitationDetails === false
        ? {}
        : { title: r.title, url: r.url, publishedAt: r.publishedAt }),
      snippet_preview: r.snippet?.trim()
        ? truncateSnippet(r.snippet, 360)
        : undefined,
    }
  })

  return {
    search_status: "ok" as const,
    query: output["query"],
    total: output["total"],
    provider: output["provider"],
    references,
  }
}

const REASONING_JSON_MARKER = "已完成子任务结果（JSON）："

/**
 * 推理 prompt 截断：保留用户需求与完整参考文献块，仅压缩 JSON 段。
 */
export function clampReasoningPrompt(text: string, limit: number | undefined): string {
  const lim = typeof limit === "number" && Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
  if (!lim || text.length <= lim) return text

  const markerIdx = text.indexOf(REASONING_JSON_MARKER)
  if (markerIdx < 0) {
    return text.slice(0, lim)
  }

  const head = text.slice(0, markerIdx + REASONING_JSON_MARKER.length)
  if (head.length >= lim) return head.slice(0, lim)

  const body = text.slice(head.length)
  const marker = "\n\n[...subtask results truncated by contextLimit...]\n\n"
  const available = lim - head.length
  if (body.length <= available) return head + body
  if (available <= marker.length) return head + body.slice(0, available)

  // Keep both the beginning of the result JSON and the final tool guidance.
  // The visible marker makes the omitted middle explicit; no part can exceed lim.
  const retained = available - marker.length
  const leading = Math.ceil(retained * 0.7)
  const trailing = retained - leading
  return `${head}${body.slice(0, leading)}${marker}${trailing > 0 ? body.slice(-trailing) : ""}`
}
