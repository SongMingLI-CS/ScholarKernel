import type { AcademicSearchHit, AcademicSearchResponse } from "@/lib/tools/search-tool"

/** Tavily advanced 检索默认召回条数 */
export const DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS = 10

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
    if (!url || seen.has(url)) continue
    seen.add(url)
    merged.push({ ...r, source_id: "" })
  }

  return merged.map((r, idx) => ({ ...r, source_id: String(idx + 1) }))
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

  const mergedHits = mergeAcademicSearchHits([], responses.flatMap((r) => r.results ?? []))
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

/** 子任务 JSON 中保留全部引用元数据，仅压缩摘要预览 */
export function serializeResearchOutputForReasoning(output: Record<string, unknown>) {
  const results = Array.isArray(output["results"]) ? (output["results"] as AcademicSearchHit[]) : []
  const references = results.map((r, i) => {
    const sid = r.source_id?.trim() ? r.source_id.trim() : String(i + 1)
    return {
      source_id: sid,
      title: r.title,
      url: r.url,
      publishedAt: r.publishedAt,
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
    return text.slice(0, lim) + "\n\n[...truncated by contextLimit...]"
  }

  const head = text.slice(0, markerIdx + REASONING_JSON_MARKER.length)
  const jsonPart = text.slice(markerIdx + REASONING_JSON_MARKER.length)
  const reserved = lim - head.length - 64
  if (reserved <= 0) return head + "\n\n[...truncated by contextLimit...]"

  const jsonBudget = Math.max(200, reserved)
  const trimmedJson =
    jsonPart.length <= jsonBudget
      ? jsonPart
      : `${jsonPart.slice(0, jsonBudget)}\n\n[...subtask JSON truncated; full references kept above...]`

  return head + trimmedJson
}
