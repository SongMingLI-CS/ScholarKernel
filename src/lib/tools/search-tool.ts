import { tool, zodSchema } from "ai"
import { z } from "zod"

import { useAgentStore } from "@/store/useAgentStore"
import { proxyAwareFetch } from "@/lib/proxy-client"

import {
  DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS,
  mergeAcademicSearchHits,
} from "@/lib/tools/academic-search-strategy"

export type AcademicSearchProvider = "tavily" | "serper"

export type AcademicSearchHit = {
  /**
   * 稳定引用 ID：用于把观点中的 [1][2] 映射到 References。
   * 约定：source_id 与 synthesizeCitationsMarkdown 的编号一致（1-based）。
   */
  source_id: string
  title: string
  url: string
  snippet?: string
  publishedAt?: string
  source?: string
}

export type AcademicSearchResponse = {
  provider: AcademicSearchProvider
  query: string
  academicOnly: boolean
  total: number
  results: AcademicSearchHit[]
  /** ok=有结果；empty=有原始命中但被 academicOnly 滤空；failed=Tavily 原始零命中 */
  status: "ok" | "empty" | "failed"
  /** 无结果或降级时的自然语言说明，供大模型继续推理 */
  message?: string
}

const AcademicSearchInputSchema = z.object({
  search_query: z.string().min(1),
  academicOnly: z.boolean().optional().default(true),
  maxResults: z.number().int().min(1).max(20).optional().default(DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS),
  /** 关键词多样化：并行检索多组 query（Planner 对宽泛主题应输出此字段） */
  search_queries: z.array(z.string().min(1)).min(1).max(4).optional(),
})

const ACADEMIC_DOMAINS = [
  "arxiv.org",
  "nature.com",
  "science.org",
  "acm.org",
  "dl.acm.org",
  "ieee.org",
  "ieeexplore.ieee.org",
  "springer.com",
  "link.springer.com",
  "sciencedirect.com",
  "journals.sagepub.com",
  "cell.com",
  "nejm.org",
  "pnas.org",
  "openreview.net",
  "semanticscholar.org",
  "biorxiv.org",
  "medrxiv.org",
]

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

function trimKey(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : ""
}

function stripBearerPrefix(key: string): string {
  return key.replace(/^bearer\s+/i, "").trim()
}

function safeEnv(name: string): string {
  try {
    const v = (process.env as Record<string, string | undefined> | undefined)?.[name]
    return typeof v === "string" ? v.trim() : ""
  } catch {
    return ""
  }
}

function isUsableSearchKey(value: string | undefined | null): boolean {
  const t = stripBearerPrefix(trimKey(value))
  if (!t) return false
  if (t.length < 8) return false
  if (/dummy/i.test(t)) return false
  if (/^(sk|tvly)-test-/i.test(t)) return false
  return true
}

function pickSearchKey(...candidates: (string | undefined | null)[]): string {
  for (const candidate of candidates) {
    const normalized = stripBearerPrefix(trimKey(candidate))
    if (isUsableSearchKey(normalized)) return normalized
  }
  return ""
}


function readSearchKeysFromStore(): { tavily: string; serper: string } {
  try {
    const state = useAgentStore.getState()
    const rk = state.actions.getRuntimeKeys?.() ?? state.runtimeKeys ?? null
    return {
      tavily: trimKey(rk?.tavily),
      serper: trimKey(rk?.serper),
    }
  } catch {
    return { tavily: "", serper: "" }
  }
}

export type ResolvedSearchApiKeys = {
  tavilyApiKey: string
  serperApiKey: string
}

/** 多级回退：注入快照 → Zustand Store → 环境变量 */
export function resolveSearchApiKeys(injected?: {
  tavilyApiKey?: string
  serperApiKey?: string
}): ResolvedSearchApiKeys {
  const fromStore = readSearchKeysFromStore()

  const tavilyApiKey = pickSearchKey(
    injected?.tavilyApiKey,
    fromStore.tavily,
    safeEnv("TAVILY_API_KEY"),
    safeEnv("NEXT_PUBLIC_TAVILY_API_KEY")
  )

  const serperApiKey = pickSearchKey(
    injected?.serperApiKey,
    fromStore.serper,
    safeEnv("SERPER_API_KEY"),
    safeEnv("NEXT_PUBLIC_SERPER_API_KEY")
  )

  return { tavilyApiKey, serperApiKey }
}

function normalizeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isAcademicHost(host: string): boolean {
  if (host.endsWith(".edu")) return true
  if (host.endsWith(".ac.uk")) return true
  return ACADEMIC_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
}

function filterAcademicOnly(results: AcademicSearchHit[]): AcademicSearchHit[] {
  return results.filter((r) => {
    const h = normalizeHost(r.url)
    return h ? isAcademicHost(h) : false
  })
}

/** 确保 query 为纯净字符串；含中文时记录日志（上游应已通过 LLM 改写为英文）。 */
function sanitizeSearchQuery(query: string): string {
  const optimizedQuery = String(query ?? "").trim()
  if (/[\u4e00-\u9fff]/.test(optimizedQuery)) {
    console.warn(
      "⚠️ search_query 仍含中文字符，Tavily 命中率可能下降。请确认 query 改写层已生效:",
      optimizedQuery
    )
  }
  return optimizedQuery
}

async function tavilySearch(apiKey: string, query: string, maxResults: number): Promise<AcademicSearchHit[]> {
  const normalizedKey = stripBearerPrefix(trimKey(apiKey))
  if (!isUsableSearchKey(normalizedKey)) {
    throw new Error("MissingSearchApiKey")
  }

  const optimizedQuery = sanitizeSearchQuery(query)
  console.log("🔍 Tavily Search Query:", optimizedQuery)

  const url = isBrowser() ? "/api/proxy/tavily/search" : "https://api.tavily.com/search"
  const requestBody = {
    api_key: normalizedKey,
    query: optimizedQuery,
    search_depth: "advanced" as const,
    include_answer: false,
    max_results: maxResults,
    // 已移除 include_domains / exclude_domains 等严苛过滤，避免误杀有效结果
  }

  console.log("🚀 [Tavily Request Payload]:", JSON.stringify(requestBody))

  const res = await proxyAwareFetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${normalizedKey}`,
    },
    body: JSON.stringify(requestBody),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`TavilySearchFailed:${res.status}:${txt || res.statusText}`)
  }

  const rawData = (await res.json()) as unknown
  console.log("📦 [Tavily Raw Response]:", JSON.stringify(rawData))

  const rec =
    rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : {}
  const resultsCandidate = rec["results"] ?? rec["data"]
  const resultsArray = Array.isArray(resultsCandidate) ? resultsCandidate : []

  if (!Array.isArray(resultsCandidate)) {
    console.warn(
      "⚠️ Tavily 返回的 results/data 不是数组，已兜底为空数组。原始 keys:",
      Object.keys(rec)
    )
  }
  if (resultsArray.length === 0) {
    console.warn("⚠️ Tavily 返回了空数据，请检查请求参数是否合法。")
  }

  return resultsArray
    .map((r) => {
      const rr = r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {}
      return {
        source_id: "",
        title: typeof rr["title"] === "string" ? rr["title"] : String(rr["title"] ?? ""),
        url: typeof rr["url"] === "string" ? rr["url"] : String(rr["url"] ?? ""),
        snippet: typeof rr["content"] === "string" ? (rr["content"] as string) : undefined,
        publishedAt: typeof rr["published_date"] === "string" ? (rr["published_date"] as string) : undefined,
        source: "tavily" as const,
      }
    })
    .map((r) => ({
      source_id: "",
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet: r.snippet,
      publishedAt: r.publishedAt,
      source: "tavily",
    }))
    .filter((r: AcademicSearchHit) => r.title && r.url)
}

async function serperSearch(apiKey: string, query: string, maxResults: number): Promise<AcademicSearchHit[]> {
  const normalizedKey = stripBearerPrefix(trimKey(apiKey))
  if (!isUsableSearchKey(normalizedKey)) {
    throw new Error("MissingSearchApiKey")
  }

  const url = isBrowser() ? "/api/proxy/serper/search" : "https://google.serper.dev/search"
  const res = await proxyAwareFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": normalizedKey },
    body: JSON.stringify({ q: query, num: maxResults }),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => "")
    throw new Error(`SerperSearchFailed:${res.status}:${txt || res.statusText}`)
  }
  const data = (await res.json()) as unknown
  const rec = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
  const organic = Array.isArray(rec["organic"]) ? (rec["organic"] as unknown[]) : []
  return organic
    .map((r) => {
      const rr = r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {}
      return {
        source_id: "",
        title: typeof rr["title"] === "string" ? rr["title"] : String(rr["title"] ?? ""),
        url: typeof rr["link"] === "string" ? rr["link"] : String(rr["link"] ?? ""),
        snippet: typeof rr["snippet"] === "string" ? (rr["snippet"] as string) : undefined,
        publishedAt: typeof rr["date"] === "string" ? (rr["date"] as string) : undefined,
        source: "serper" as const,
      }
    })
    .map((r) => ({
      source_id: "",
      title: String(r.title ?? ""),
      url: String(r.url ?? ""),
      snippet: r.snippet,
      publishedAt: r.publishedAt,
      source: "serper",
    }))
    .filter((r: AcademicSearchHit) => r.title && r.url)
}

export function createAcademicSearchTool(input: {
  tavilyApiKey?: string
  serperApiKey?: string
  onLog?: (line: string) => void
}) {
  return tool({
    description:
      "深度学术检索（Tavily advanced / max_results=10）：返回标题/链接/摘要/发布日期。" +
      "search_query 须为纯英文学术关键词；宽泛主题请用 search_queries 数组并行多路检索。" +
      "可开启 academicOnly 过滤学术域名。",
    inputSchema: zodSchema(AcademicSearchInputSchema),
    execute: async ({ search_query, search_queries, academicOnly, maxResults }) => {
      const queryList =
        Array.isArray(search_queries) && search_queries.length
          ? search_queries.map((q) => sanitizeSearchQuery(q)).filter(Boolean)
          : [sanitizeSearchQuery(search_query)]
      const query = queryList.join(" | ")
      const wantAcademicOnly = Boolean(academicOnly)
      const n = maxResults ?? DEFAULT_ACADEMIC_SEARCH_MAX_RESULTS

      const { tavilyApiKey: tavilyKey, serperApiKey: serperKey } = resolveSearchApiKeys({
        tavilyApiKey: input.tavilyApiKey,
        serperApiKey: input.serperApiKey,
      })

      const provider: AcademicSearchProvider | null = tavilyKey ? "tavily" : serperKey ? "serper" : null
      if (!provider) {
        console.error("❌ 致命错误: Tavily/Serper API Key 彻底丢失")
        throw new Error("MissingSearchApiKey")
      }

      if (provider === "tavily") {
        console.log("✅ 成功拿到 Tavily Key，长度为:", tavilyKey.length)
        input.onLog?.(`[Key] Tavily 已就绪（${tavilyKey.length} chars）`)
      } else {
        console.log("✅ 成功拿到 Serper Key，长度为:", serperKey.length)
        input.onLog?.(`[Key] Serper 已就绪（${serperKey.length} chars）`)
      }

      input.onLog?.(
        `正在检索：${provider === "tavily" ? "Tavily (advanced)" : "Serper/Google"}…` +
          (queryList.length > 1 ? ` · ${queryList.length} 路并行` : "")
      )

      const runOne = async (q: string) =>
        provider === "tavily" ? await tavilySearch(tavilyKey!, q, n) : await serperSearch(serperKey!, q, n)

      const batches = await Promise.all(queryList.map(runOne))
      const raw = mergeAcademicSearchHits([], batches.flat())

      const filtered0 = wantAcademicOnly ? filterAcademicOnly(raw) : raw
      // Attach stable source_id (1-based) for citation tracking.
      const filtered: AcademicSearchHit[] = filtered0.map((r, idx) => ({
        ...r,
        source_id: String(idx + 1),
      }))

      if (raw.length > 0 && filtered.length === 0 && wantAcademicOnly) {
        console.warn(
          `⚠️ Tavily 返回 ${raw.length} 条原始结果，但 academicOnly 过滤后为空。可尝试 academicOnly=false。`
        )
        input.onLog?.(`原始 ${raw.length} 条，学术域名过滤后为 0 条`)
      } else {
        input.onLog?.(`找到 ${filtered.length} 条可用结果（raw=${raw.length}）`)
      }

      let status: AcademicSearchResponse["status"] = "ok"
      let emptyMessage: string | undefined

      if (filtered.length === 0) {
        if (provider === "tavily" && raw.length === 0) {
          status = "failed"
          emptyMessage =
            "Tavily 返回 0 条结果。请更换检索关键词（建议使用纯英文专业术语）后重新发起检索任务。"
        } else if (raw.length > 0 && wantAcademicOnly) {
          status = "empty"
          emptyMessage =
            "检索工具未能找到符合学术域名过滤条件的文献，请提示用户关闭 academicOnly 或更换关键词。"
        } else {
          status = "empty"
          emptyMessage = "检索工具未能找到相关文献，请提示用户更换关键词或放宽检索条件。"
        }
      }

      const out: AcademicSearchResponse = {
        provider,
        query,
        academicOnly: wantAcademicOnly,
        total: filtered.length,
        results: filtered,
        status,
        ...(emptyMessage ? { message: emptyMessage } : {}),
      }

      if (status === "failed" || status === "empty") {
        console.warn("⚠️ academicSearch 零命中:", JSON.stringify({ status, query, message: emptyMessage }))
        input.onLog?.(`[${status === "failed" ? "Failed" : "Empty"}] ${emptyMessage ?? "检索零命中"}`)
      }

      return out
    },
  })
}

export function synthesizeCitationsMarkdown(results: AcademicSearchHit[], title = "## 参考文献 (References)") {
  if (!results.length) return { markdown: "", count: 0 }
  const lines = results.slice(0, 24).map((r, i) => {
    const sid = r.source_id?.trim() ? r.source_id.trim() : String(i + 1)
    const yearMatch = r.publishedAt?.match(/\b(19|20)\d{2}\b/)
    const year = yearMatch ? ` (${yearMatch[0]})` : r.publishedAt ? ` (${r.publishedAt})` : ""
    return `[${sid}] ${r.title}${year}`
  })
  return {
    count: results.length,
    markdown: [`${title}`, "", ...lines].join("\n"),
  }
}

