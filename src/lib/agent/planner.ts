import { z } from "zod"

import { SCHOLAR_CANVAS_OUTPUT_DISCIPLINE } from "@/lib/scholar-canvas"
import { buildDualSearchQueries, isSurveyOrProgressTopic } from "@/lib/tools/academic-search-strategy"

export type WorkflowTaskType = "read_file" | "reasoning" | "audit" | "research"
export type WorkflowProvider = "local" | "cloud"
export type WorkflowStatus = "pending" | "running" | "done" | "error"

export type WorkflowNode = {
  id: string
  type: WorkflowTaskType
  provider: WorkflowProvider
  status: WorkflowStatus
  title?: string
  input?: unknown
  output?: unknown
  error?: string
  logs?: string[]
  metadata?: Record<string, unknown>
}

export type ActiveProviderId = "ollama" | "openai" | "anthropic" | "google" | "deepseek_openai_compat"

export type ActiveProviderConfig = {
  providerId: ActiveProviderId
  model: string
  baseUrl?: string
}

export type ChatHistoryEntry = {
  role: "user" | "assistant" | "system"
  content: string
}

/** 规划阶段 JSON 无法解析或不符合协议时抛出；UI 可降级展示 rawContent 并允许用户重试。 */
export class WorkflowPlanParseError extends Error {
  readonly rawContent: string
  readonly causeDetail?: string
  constructor(rawContent: string, message?: string, causeDetail?: string) {
    super(message ?? "WorkflowPlanParseError")
    this.name = "WorkflowPlanParseError"
    this.rawContent = rawContent
    this.causeDetail = causeDetail
  }
}

const TaskSchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .transform((val) => String(val))
    .refine((s) => s.trim().length > 0, "id must be non-empty"),
  type: z.enum(["read_file", "reasoning", "audit", "research"]),
  provider: z.enum(["local", "cloud"]),
  status: z.enum(["pending", "running", "done", "error"]).optional().default("pending"),
  title: z.string().optional(),
  input: z.unknown().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const TaskListSchema = z.array(TaskSchema).min(1)
// 已禁用 superRefine：不再因 read_file/research 缺参而清空任务列表
// .superRefine((items, ctx) => { ... })

function pickFirstJsonFence(text: string): string | null {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return m?.[1] ? m[1].trim() : null
}

/** 展开 Markdown 代码块：把 ```json ... ``` 内联为纯文本，便于后续「暴力」正则截取。 */
function stripMarkdownCodeFencesInline(text: string): string {
  return text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "\n$1\n")
}

function tryJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function extractBalancedJsonBlock(text: string): { block: string; start: number; end: number } | null {
  const t = text
  const start = Math.min(
    ...[t.indexOf("["), t.indexOf("{")].filter((i) => i >= 0)
  )
  if (!Number.isFinite(start) || start < 0) return null

  const open = t[start]!
  const close = open === "[" ? "]" : "}"
  let depth = 0
  let inStr = false
  let esc = false

  for (let i = start; i < t.length; i++) {
    const ch = t[i]!
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === "\\") {
        esc = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }

    if (ch === '"') {
      inStr = true
      continue
    }

    if (ch === open) depth++
    if (ch === close) depth--
    if (depth === 0) {
      const end = i + 1
      return { block: t.slice(start, end), start, end }
    }
  }

  return null
}

/**
 * 从 LLM 混排文本中提取 JSON 子串（优先按用户指定正则），仅对匹配片段做 JSON.parse。
 * 若贪婪匹配导致 JSON 损坏，则回退到括号平衡算法在同一窗口内截取。
 */
function extractJSON(content: string): string | null {
  const trimmed = content.trim()
  const jsonMatch = trimmed.match(/\[[\s\S]*\]|\{[\s\S]*\}/)
  return jsonMatch?.[0] ?? null
}

function parseJsonFromLlmText(raw: string): unknown {
  const t = stripMarkdownCodeFencesInline(raw).trim()
  const fenced = pickFirstJsonFence(t)
  if (fenced) {
    try {
      return JSON.parse(fenced)
    } catch {
      // continue
    }
  }

  const matched = extractJSON(t)
  if (matched) {
    try {
      return JSON.parse(matched)
    } catch {
      const relStart = t.indexOf(matched)
      const window = relStart >= 0 ? t.slice(relStart) : t
      const balanced = extractBalancedJsonBlock(window)
      if (balanced) {
        try {
          return JSON.parse(balanced.block)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          throw new Error(`InvalidJSON:AfterRegexBalance:${msg}`)
        }
      }
    }
  }

  const extracted = extractBalancedJsonBlock(t)
  if (extracted) {
    try {
      return JSON.parse(extracted.block)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`InvalidJSON:Balanced:${msg}`)
    }
  }

  try {
    return JSON.parse(t)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`InvalidJSON:Raw:${msg}`)
  }
}

const TASK_ARRAY_KEYS = [
  "tasks",
  "task_list",
  "taskList",
  "plan",
  "workflow",
  "nodes",
  "steps",
  "items",
  "data",
  "result",
] as const

function looksLikeTaskArray(arr: unknown[]): boolean {
  if (arr.length === 0) return true
  const first = arr[0]
  if (!first || typeof first !== "object" || Array.isArray(first)) return false
  const rec = first as Record<string, unknown>
  return typeof rec["type"] === "string" || typeof rec["id"] !== "undefined"
}

/** 从 JSON.parse 结果中探测 tasks 数组，兼容顶层数组、{ tasks: [] } 及多层嵌套包装。 */
function extractRawJsonTasks(parsedJson: unknown): unknown[] {
  if (Array.isArray(parsedJson)) {
    return looksLikeTaskArray(parsedJson) ? parsedJson : []
  }

  const visited = new Set<unknown>()
  const queue: unknown[] = [parsedJson]

  while (queue.length > 0) {
    const cur = queue.shift()
    if (cur == null || visited.has(cur)) continue
    visited.add(cur)

    if (Array.isArray(cur)) {
      if (looksLikeTaskArray(cur)) return cur
      for (const item of cur) queue.push(item)
      continue
    }

    if (typeof cur !== "object") continue
    const o = cur as Record<string, unknown>

    for (const k of TASK_ARRAY_KEYS) {
      const v = o[k]
      if (Array.isArray(v) && looksLikeTaskArray(v)) return v
    }

    for (const v of Object.values(o)) {
      if (v && typeof v === "object") queue.push(v)
    }
  }

  console.warn("未找到 tasks 数组，原始 JSON:", parsedJson)
  return []
}

/** 从崩坏字符串中暴力提取 JSON 子串（Markdown 围栏 / 贪婪括号 / 平衡括号）。 */
function coerceParsedPlanFromRawText(rawText: string): unknown {
  const stripped = stripMarkdownCodeFencesInline(String(rawText ?? "")).trim()
  if (!stripped) return null

  const candidates: string[] = []
  const fenced = pickFirstJsonFence(stripped)
  if (fenced) candidates.push(fenced)

  const bracketArr = stripped.match(/\[[\s\S]*\]/)
  if (bracketArr?.[0]) candidates.push(bracketArr[0].replace(/```json|```/gi, "").trim())

  const braceObj = stripped.match(/\{[\s\S]*\}/)
  if (braceObj?.[0]) candidates.push(braceObj[0].replace(/```json|```/gi, "").trim())

  const balanced = extractBalancedJsonBlock(stripped)
  if (balanced?.block) candidates.push(balanced.block)

  candidates.push(stripped)

  for (const cand of candidates) {
    const parsed = tryJsonParse(cand)
    if (parsed != null) return parsed
  }

  try {
    return parseJsonFromLlmText(stripped)
  } catch {
    return null
  }
}

function unwrapWorkflowPlanPayload(data: unknown): unknown {
  const tasks = extractRawJsonTasks(data)
  return tasks.length > 0 ? tasks : data
}

const WORKFLOW_TASK_TYPES = ["read_file", "reasoning", "audit", "research"] as const

/** 规划彻底失败或任务数组为空时的保底单节点，避免右侧拓扑留空。 */
const FALLBACK_TASK_LIST: z.infer<typeof TaskListSchema> = [
  {
    id: "kg-fallback-1",
    type: "reasoning",
    provider: "cloud",
    status: "pending",
    title: "知识图谱直接回答",
    input: { query: "基于内置知识图谱与对话上下文直接回答用户，无需外部检索。" },
    metadata: { fallback: true, fallbackReason: "plan_parse_failed" },
  },
]

const KG_DIRECT_ANSWER_TASK = FALLBACK_TASK_LIST[0]!

function normalizeTaskType(raw: unknown): WorkflowTaskType {
  if (typeof raw === "string" && (WORKFLOW_TASK_TYPES as readonly string[]).includes(raw)) {
    return raw as WorkflowTaskType
  }
  return "reasoning"
}

/** 模型输出脏数据：在 Zod 校验前强制清洗字段，降低规划崩溃概率。 */
function sanitizeTaskItem(task: unknown, index: number): Record<string, unknown> {
  const t =
    task && typeof task === "object" && !Array.isArray(task) ? (task as Record<string, unknown>) : {}

  let input: Record<string, unknown> =
    t.input && typeof t.input === "object" && !Array.isArray(t.input)
      ? (t.input as Record<string, unknown>)
      : {}
  if (!Object.keys(input).length && t.input != null && typeof t.input !== "object") {
    input = { raw: t.input }
  }

  let type = normalizeTaskType(t.type)
  if (type === "read_file") {
    const path = typeof input.path === "string" ? input.path.trim() : ""
    if (!path) type = "reasoning"
  }
  if (type === "research") {
    let q = typeof input.search_query === "string" ? input.search_query.trim() : ""
    if (!q && typeof input.query === "string") {
      q = input.query.trim()
      input = { ...input, search_query: q }
    }
    if (!q) type = "reasoning"
  }

  const idRaw = t.id ?? index + 1
  const id = String(idRaw).trim() || String(index + 1)

  const title =
    typeof t.title === "string"
      ? t.title
      : t.title != null && t.title !== ""
        ? String(t.title)
        : undefined

  const metadata =
    t.metadata && typeof t.metadata === "object" && !Array.isArray(t.metadata)
      ? (t.metadata as Record<string, unknown>)
      : undefined

  return {
    ...t,
    id,
    status: "pending",
    provider: "cloud",
    type,
    input,
    ...(title !== undefined ? { title } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  }
}

function sanitizeTaskList(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return []
  return data.map((item, index) => sanitizeTaskItem(item, index))
}

function normalizeModelId(providerId: ActiveProviderId, model: string) {
  if (providerId === "deepseek_openai_compat") return "deepseek-chat"
  const m = (model ?? "").trim()
  return m
}

/** 规划与拦截路径统一：禁止 local，推理侧使用当前云端模型 ID（active 非 Ollama）或 deepseek-chat（默认兜底）。 */
export function applyCloudOnlyWorkflowNormalization(nodes: WorkflowNode[], active: ActiveProviderConfig): WorkflowNode[] {
  const cloudModelId =
    active.providerId !== "ollama" ? normalizeModelId(active.providerId, active.model) : "deepseek-chat"

  return nodes.map((n) => ({
    ...n,
    provider: "cloud",
    metadata: {
      ...n.metadata,
      inferenceModel: cloudModelId,
    },
  }))
}

/** 含明显「可执行子任务 / 文件 / 检索」语义的输入不走直连对话（避免跳过规划）。 */
const DIRECT_CHAT_TASK_HINT =
  /read_file|academicSearch|search_query|再找|再搜|搜索|检索|查找|文献|查一下|搜一下|审查|audit|review|论文|paper|literature|\.tsx?\b|\.jsx?\b|\.py\b|\.go\b|\.rs\b|src\/[\w./-]+|arxiv\.org|scholar\.google|任务规划|\{\s*"tasks"\s*:/i

/** 用户要求深入解读上一轮已召回的论文（须从历史提炼标题再检索，禁止 read_file）。 */
export function needsPaperDetailIntent(text: string): boolean {
  return /详解|详细解读|深入分析|展开讲|详细说明|上一篇|刚才那篇|那篇论文|这篇论文|上一轮|刚才介绍|刚才提到|全文|full\s*text|paper\s+details?|explain.*paper|解读.*论文|分析.*论文/i.test(
    text
  )
}

/** 用户意图需要走 research 工具（含上下文续搜「再找一篇」、详解上一轮论文等）。 */
export function needsResearchIntent(text: string): boolean {
  return (
    needsPaperDetailIntent(text) ||
    /最新|近期|对比|比较|论文|paper|arxiv|survey|综述|再找|再搜|搜索|检索|查找|文献|查一下|搜一下|literature|search/i.test(
      text
    )
  )
}

/** 判断 path 是否像本地项目文件（而非论文标题/URL）。 */
function isLikelyLocalProjectPath(path: string): boolean {
  const p = path.replace(/\\/g, "/").trim()
  if (!p) return false
  if (/^https?:\/\//i.test(p) || /^arxiv\.org/i.test(p) || /^www\./i.test(p)) return false
  if (/\.(tsx?|jsx?|py|go|rs|java|kt|swift|rb|php|cs|cpp|c|h|hpp|md|json|yaml|yml|toml|css|scss|html|vue|svelte|log|txt|sql|prisma|graphql)$/i.test(p)) {
    return true
  }
  if (/^(src|app|lib|pages|components|prisma|public|logs|test|tests|__tests__|scripts|config)\//i.test(p)) {
    return true
  }
  return false
}

/** 判断 path 是否被误当作本地路径的远程文献引用。 */
function isLikelyRemotePaperReference(path: string): boolean {
  const p = path.trim()
  if (!p) return false
  if (/^https?:\/\//i.test(p) || /arxiv\.org|doi\.org|scholar\.google|semanticscholar|pubmed|ieee\.org|acm\.org/i.test(p)) {
    return true
  }
  if (/\.pdf$/i.test(p) && !isLikelyLocalProjectPath(p)) return true
  if (!isLikelyLocalProjectPath(p) && !p.includes("/") && p.length > 20) return true
  if (!isLikelyLocalProjectPath(p) && /paper|survey|arxiv|proceedings|journal|conference/i.test(p)) return true
  return false
}

function extractPaperTitlesFromContent(content: string): string[] {
  const titles: string[] = []
  const refRe = /^\s*\[(\d+)\]\s*(.+?)(?:\s*\((?:19|20)\d{2}[^)]*\))?\s*$/gm
  for (const m of content.matchAll(refRe)) {
    const title = m[2]?.trim()
    if (title && title.length > 4) titles.push(title)
  }
  return titles
}

/** 从对话历史 assistant 的参考文献区提炼论文标题（供第二轮「详解上一篇」检索）。 */
function extractPaperTitleFromHistory(
  history: ChatHistoryEntry[] | undefined,
  userInput: string
): string | null {
  if (!history?.length) return null
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant" && (m.content ?? "").trim())
  if (!lastAssistant?.content?.trim()) return null

  const titles = extractPaperTitlesFromContent(lastAssistant.content)
  if (!titles.length) return null

  const citeMatch = userInput.match(/\[(\d+)\]/)
  if (citeMatch) {
    const idx = parseInt(citeMatch[1], 10) - 1
    if (idx >= 0 && idx < titles.length) return titles[idx]!
  }

  if (/上一篇|刚才|那篇|这篇|上一轮|last\s+paper|that\s+paper|the\s+paper/i.test(userInput)) {
    return titles[0]!
  }

  for (const title of titles) {
    const words = title.split(/\s+/).filter((w) => w.length > 4)
    if (words.some((w) => userInput.toLowerCase().includes(w.toLowerCase()))) return title
    const short = title.slice(0, 32)
    if (short.length > 6 && userInput.includes(short)) return title
  }

  return titles[0]!
}

export function buildPaperDetailSearchQuery(userInput: string, history: ChatHistoryEntry[] | undefined): string | null {
  const title = extractPaperTitleFromHistory(history, userInput)
  if (title) return `${title} full paper arxiv`
  return null
}

function asRecord(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

/** 将误规划为 read_file 的远程文献读取纠正为 research 检索。 */
export function correctMisplacedReadFileNodes(
  nodes: WorkflowNode[],
  userInput: string,
  history: ChatHistoryEntry[] | undefined
): WorkflowNode[] {
  return nodes.map((n) => {
    if (n.type !== "read_file") return n
    const inp = asRecord(n.input)
    const path = typeof inp["path"] === "string" ? String(inp["path"]).trim() : ""
    if (!path || isLikelyLocalProjectPath(path)) return n

    const fromHistory = extractPaperTitleFromHistory(history, userInput)
    const searchQuery = fromHistory ?? (isLikelyRemotePaperReference(path) ? path.replace(/\.pdf$/i, "").trim() : path)

    console.warn("⚠️ 检测到 read_file 误用于远程文献，纠正为 research:", { path, searchQuery })

    return {
      ...n,
      type: "research",
      title: n.title?.includes("检索") ? n.title : "学术检索（纠正误规划）",
      input: {
        search_query: buildPaperDetailSearchQuery(userInput, history) ?? `${searchQuery} arxiv paper`,
        academicOnly: true,
      },
      metadata: {
        ...n.metadata,
        correctedFrom: "read_file",
        originalPath: path,
      },
    }
  })
}

export function buildFallbackSearchQuery(userInput: string, history: ChatHistoryEntry[] | undefined): string {
  const s = userInput.trim()

  if (needsPaperDetailIntent(s)) {
    const titleQuery = buildPaperDetailSearchQuery(s, history)
    if (titleQuery) return titleQuery
  }

  const isVague = /^(再|还|帮).{0,8}(找|搜|查)|^(找|搜|查).{0,6}(一篇|一下|文献|论文)/i.test(s)

  const CN_TOPIC_MAP: Array<[RegExp, string]> = [
    [/计算机视觉|视觉/i, "computer vision"],
    [/自然语言|NLP|语言模型/i, "natural language processing large language models"],
    [/深度学习|深度/i, "deep learning"],
    [/机器学习/i, "machine learning"],
    [/强化学习/i, "reinforcement learning"],
    [/Transformer/i, "Transformer architecture"],
    [/Mamba/i, "Mamba architecture"],
    [/扩散|diffusion/i, "diffusion models"],
    [/论文|文献|研究/i, "research papers arxiv"],
  ]

  function expandChineseToEnglish(text: string): string {
    if (!/[\u4e00-\u9fff]/.test(text)) return text
    const parts: string[] = []
    for (const [re, en] of CN_TOPIC_MAP) {
      if (re.test(text)) parts.push(en)
    }
    if (parts.length === 0) return `latest ${text} research papers arxiv`
    return `latest ${parts.join(" ")} research papers arxiv`
  }

  if (!isVague || !history?.length) return expandChineseToEnglish(s)

  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant" && (m.content ?? "").trim())
  if (!lastAssistant?.content?.trim()) return expandChineseToEnglish(s)

  const topicHint = lastAssistant.content
    .replace(/\[(\d+)\]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .slice(0, 400)
    .trim()

  const combined = `${s} ${topicHint}`.slice(0, 280)
  return expandChineseToEnglish(combined)
}

/** 综述/核心进展类：自动插入双路 research（Survey + Methodology），再进入 reasoning 聚合。 */
export function ensureMultiSourceResearchPlan(nodes: WorkflowNode[], userInput: string): WorkflowNode[] {
  if (!isSurveyOrProgressTopic(userInput)) return nodes

  const researchIndices = nodes.map((n, i) => (n.type === "research" ? i : -1)).filter((i) => i >= 0)
  if (researchIndices.length >= 2) return nodes

  const firstIdx = researchIndices[0]
  const firstResearch = firstIdx != null ? nodes[firstIdx] : null
  const inp = asRecord(firstResearch?.input)
  const draftQ =
    typeof inp["search_query"] === "string"
      ? String(inp["search_query"])
      : typeof inp["query"] === "string"
        ? String(inp["query"])
        : buildFallbackSearchQuery(userInput, undefined)

  const [surveyQ, methodQ] = buildDualSearchQueries(userInput, draftQ)

  const surveyNode: WorkflowNode = {
    id: firstResearch?.id ?? "research-survey-1",
    type: "research",
    provider: "cloud",
    status: "pending",
    title: "综述/Survey 检索",
    input: { search_query: surveyQ.trim(), academicOnly: true },
    logs: firstResearch?.logs ?? [],
    metadata: { kind: "multi-source", searchPass: "survey", queryExpanded: true },
  }
  const methodNode: WorkflowNode = {
    id: "research-method-2",
    type: "research",
    provider: "cloud",
    status: "pending",
    title: "核心模型/方法论检索",
    input: { search_query: methodQ.trim(), academicOnly: true },
    logs: [],
    metadata: { kind: "multi-source", searchPass: "methodology", queryExpanded: true },
  }

  if (firstIdx == null) {
    return [surveyNode, methodNode, ...nodes]
  }

  const updated = [...nodes]
  updated[firstIdx] = surveyNode
  updated.splice(firstIdx + 1, 0, methodNode)
  return updated
}

export const PLAN_TOOL_ENFORCEMENT = [
  "【硬性反幻觉 — 必须遵守】",
  "当用户意图包含检索、查找文献、审查代码、读取文件、对比论文等需要调用工具的动作时：",
  "- 严禁输出任何自然语言对话（如「好的，我来搜索」「让我帮你查一下」「正在检索中」）。",
  "- 你必须且只能输出 JSON 任务数组（或 {\"tasks\":[...]}），且必须包含对应工具类型节点（research / read_file / audit）。",
  "- 绝不要把「口头承诺」当作任务完成；执行由下游节点负责，你只负责规划 JSON。",
].join("\n")

export const PLAN_QUERY_OPTIMIZATION = [
  "【检索词优化 — research 节点 input — 绝对指令】",
  "- search_query 必须是提炼后的纯英文学术关键词；禁止中文口语。",
  "- input 字段名优先 search_query；也接受 query。",
  "",
  "【关键词多样化策略 — 宽泛主题必填】",
  "- 当主题为 LLM、计算机视觉、深度学习等宽泛领域时，必须在 input 中提供 search_queries 数组（2–3 条英文检索式），系统将并行检索后聚合。",
  "- 示例（LLM）：search_queries: [",
  '  "Recent LLM survey 2024 2025 2026 arxiv",',
  '  "State-of-the-art LLM architectures research papers",',
  '  "Core AI research papers 2024 2026 arxiv"',
  "  ]",
  "- 若仅一条 query，执行器会对宽泛主题自动扩写为上述多路检索。",
  "",
  "【多源聚合 — 综述/核心进展类 — 强制双检索】",
  "- 用户意图为综述、Survey、Review、研究进展、核心进展、前沿对比时：必须规划【两个】连续的 research 节点：",
  "  1) 第一次：survey/review/literature 向检索；",
  "  2) 第二次：state-of-the-art / core models / methodology 向检索；",
  "- 两次检索结果由 reasoning 节点聚合总结，禁止只规划单次检索。",
].join("\n")

export const PLAN_TOOL_BOUNDARY = [
  "【工具边界严律 — 必须遵守】",
  "1. read_file / localSourceAudit 工具只能且必须用于读取用户本地项目中的源代码或本地存在的文档（例如 \"src/app/page.tsx\"、\"package.json\"）。",
  "2. 严禁使用 read_file 或 localSourceAudit 去获取任何互联网上的学术论文、网页、URL、或上一轮搜索出来的在线文献详细信息！",
  "3. 若用户要求「详解/展开/深入分析上一轮某篇论文」（如 SELF 论文），你必须：",
  "   - 从 messages 历史中 assistant 的参考文献列表或摘要里提炼该论文的完整英文标题；",
  "   - 规划 research 节点，将完整标题作为 search_query 再次发起 academicSearch 检索；",
  "   - 或使用 webFetch 远程抓取（若可用）；",
  "   - 绝不要把论文标题、URL、arxiv 链接当作 read_file 的 input.path！",
  "4. read_file 的 input.path 必须是项目内相对路径且含常见源码扩展名（.ts/.tsx/.js/.jsx/.py/.go/.rs/.md/.json/.log 等）或 logs/ 前缀。",
].join("\n")

export const REASONING_TOOL_BOUNDARY = [
  "【工具边界严律 — 必须遵守】",
  "1. readLocalFile / localSourceAudit 只能读取本地项目源码或本地文档（如 src/app/page.tsx）。",
  "2. 严禁用本地读取工具获取互联网论文、网页、URL 或上一轮在线文献的全文！",
  "3. 若需获取在线论文详情，必须调用 academicSearch(search_query) 用完整论文标题重新检索，或使用 webFetch。",
].join("\n")

export const READ_FILE_LITERATURE_FALLBACK =
  "系统提示：未能直接读取该文献的全文。我将基于上一轮召回的摘要信息为您进行尽可能的推导和伪代码编写。"

/** 最终回答的 Markdown / 引用 / 公式输出纪律（推理整合、综述工具共用）。 */
export const ACADEMIC_OUTPUT_DISCIPLINE = [
  "【文献引用纪律 — 必须遵守】",
  "在回答的最后列出参考文献时，必须使用简洁的列表格式，如 [序号] 论文标题 (年份)。",
  "绝对禁止将长篇的英文 Abstract（摘要）或原始抓取文本直接粘贴到正文中！",
  "正文引用仅用 [1] [2] 等编号标注，与文末 References 列表编号一致。",
  "如果有表格，请使用标准 Markdown 表格语法；如果有数学公式，请严格使用 LaTeX 语法包围（如 $E=mc^2$ 或 $$公式$$）。",
  "",
  SCHOLAR_CANVAS_OUTPUT_DISCIPLINE,
].join("\n")

/**
 * 语义分流：问候、身份、轻量功能询问等 → 跳过 JSON 任务规划（由执行器走 DIRECT_CHAT）。
 * 保守策略：偏长或命中「任务/文件/检索」类关键词则仍走工作流。
 */
export function isDirectChatInput(raw: string): boolean {
  const s = raw.trim()
  if (!s) return false
  if (s.length > 120) return false
  if (DIRECT_CHAT_TASK_HINT.test(s)) return false

  const lower = s.toLowerCase()

  if (/^(你好|您好|在吗|在么|hi|hello|hey|早上好|中午好|晚上好|哈喽|嗨)[\s!！.。,，~～?？]*$/i.test(s)) return true
  if (/^(你是谁|你是什么|哪个模型|什么模型|who\s+are\s+you)(\?|？|\s|!|！|。|.){0,12}$/i.test(lower)) return true
  if (/(你能做什么|你有什么功能|怎么用|如何使用|有哪些功能|支持什么|介绍一下|功能列表|\bhelp\b|帮助)/i.test(s) && s.length < 96) return true
  if (/^(谢谢|多谢|感谢|好的|ok|okay|明白了|收到|再见|bye)[\s!！.。,，~～]*$/i.test(lower)) return true
  return false
}

/**
 * 解析「任务规划」JSON：优先用贪婪 `[]` / `{}` 截取并擦除 markdown 围栏后再 JSON.parse；
 * 失败则回退到括号平衡与 parseJsonFromLlmText（避免模型前后废话导致整体 JSON.parse 死路）。
 */
export function parsePlan(raw: string, structured?: unknown): unknown {
  if (structured !== undefined && structured !== null) {
    return typeof structured === "string" ? parsePlan(structured) : structured
  }

  const content = String(raw ?? "").trim()

  const bracketArr = content.match(/\[[\s\S]*\]/)
  if (bracketArr) {
    const cleanJson = bracketArr[0].replace(/```json|```/gi, "").trim()
    const parsed = tryJsonParse(cleanJson)
    if (parsed != null) return parsed
  }

  const braceObj = content.match(/\{[\s\S]*\}/)
  if (braceObj) {
    const cleanJson = braceObj[0].replace(/```json|```/gi, "").trim()
    const parsed = tryJsonParse(cleanJson)
    if (parsed != null) return parsed
  }

  const stripped = stripMarkdownCodeFencesInline(content).trim()
  return parseJsonFromLlmText(stripped)
}

/** 尝试从「对话可见文本」中剥离合法任务规划；用于与执行器规划路径解耦。不修改原始 Markdown 代码块。 */
export function interceptWorkflowPlanInAssistantBubble(
  text: string,
  active?: ActiveProviderConfig
): { cleanedText: string; planned: WorkflowNode[] } | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const lead = text.indexOf(trimmed)
  type Span = { block: string; start: number; end: number }
  let span: Span | null = null

  const rawBal = extractBalancedJsonBlock(trimmed)
  if (rawBal) {
    span = { block: rawBal.block, start: lead + rawBal.start, end: lead + rawBal.end }
  }

  if (!span) {
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
    if (fenceMatch && fenceMatch.index != null) {
      const innerBal = extractBalancedJsonBlock((fenceMatch[1] ?? "").trim())
      if (innerBal) {
        span = {
          block: innerBal.block,
          start: lead + fenceMatch.index,
          end: lead + fenceMatch.index + fenceMatch[0].length,
        }
      }
    }
  }

  if (!span) return null

  let list: z.infer<typeof TaskListSchema>
  try {
    const blockForParse = span.block.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
    const base = parsePlan(blockForParse)
    const unwrapped = unwrapWorkflowPlanPayload(base)
    const sanitized = sanitizeTaskList(unwrapped)
    if (!sanitized.length) return null
    const parsed = TaskListSchema.safeParse(sanitized)
    if (!parsed.success) {
      console.error("ZOD_ISSUES:", parsed.error.issues)
      return null
    }
    list = parsed.data
  } catch {
    return null
  }

  const plannedBase: WorkflowNode[] = list.map((t) => ({
    id: t.id,
    type: t.type,
    provider: "cloud",
    status: t.status ?? "pending",
    title: t.title,
    input: t.input,
    logs: [],
    metadata: t.metadata,
  }))

  const planned = applyCloudOnlyWorkflowNormalization(
    plannedBase,
    active ?? { providerId: "deepseek_openai_compat", model: "deepseek-chat" }
  )

  const cleanedText = `${text.slice(0, span.start).trimEnd()}\n\n${text.slice(span.end).trim()}`.trim()
  return { cleanedText, planned }
}

function recordToTaskItem(rec: Record<string, unknown>, index: number): z.infer<typeof TaskSchema> {
  let input: Record<string, unknown> =
    rec.input && typeof rec.input === "object" && !Array.isArray(rec.input)
      ? (rec.input as Record<string, unknown>)
      : {}
  if (!Object.keys(input).length && rec.input != null && typeof rec.input !== "object") {
    input = { raw: rec.input }
  }
  if (!Object.keys(input).length) {
    const legacyQuery =
      typeof rec.query === "string"
        ? rec.query.trim()
        : typeof rec.search_query === "string"
          ? rec.search_query.trim()
          : ""
    if (legacyQuery) input = { query: legacyQuery, search_query: legacyQuery }
  }

  let type = normalizeTaskType(rec.type)
  if (type === "research") {
    let q = typeof input.search_query === "string" ? input.search_query.trim() : ""
    if (!q && typeof input.query === "string") {
      q = input.query.trim()
      input = { ...input, search_query: q }
    }
    if (!q) {
      type = "reasoning"
      input = { query: "基于上下文直接回答" }
    }
  }
  if (type === "read_file") {
    const path = typeof input.path === "string" ? input.path.trim() : ""
    if (!path) {
      type = "reasoning"
      input = { query: "处理用户请求" }
    }
  }
  if ((type === "reasoning" || type === "audit") && !Object.keys(input).length) {
    input = { query: "处理用户请求" }
  }

  const idRaw = rec.id ?? index + 1
  const id = String(idRaw).trim() || String(index + 1)
  const title =
    typeof rec.title === "string" && rec.title.trim()
      ? rec.title.trim()
      : type === "research"
        ? "学术检索"
        : type === "read_file"
          ? "读取文件"
          : type === "audit"
            ? "代码审计"
            : "处理请求"

  const metadata =
    rec.metadata && typeof rec.metadata === "object" && !Array.isArray(rec.metadata)
      ? (rec.metadata as Record<string, unknown>)
      : undefined

  return {
    id,
    type,
    provider: "cloud",
    status: "pending",
    title,
    input,
    ...(metadata ? { metadata } : {}),
  }
}

function forceAssembleTasksFromRaw(rawJsonTasks: unknown[]): z.infer<typeof TaskListSchema> {
  const sanitizedTasks: z.infer<typeof TaskListSchema> = rawJsonTasks.map((t, i) => {
    const cleaned = sanitizeTaskItem(t, i)
    return recordToTaskItem(cleaned, i)
  })

  if (sanitizedTasks.length === 0) {
    console.warn("PLAN_EMPTY_TASK_ARRAY — 注入知识图谱直接回答节点")
    sanitizedTasks.push(KG_DIRECT_ANSWER_TASK)
  }

  return sanitizedTasks
}

export function parseAndValidateTaskList(rawText: string, structured?: unknown): z.infer<typeof TaskListSchema> {
  let parsedJson: unknown = null

  if (structured !== undefined && structured !== null) {
    parsedJson =
      typeof structured === "string"
        ? coerceParsedPlanFromRawText(structured) ?? parsePlan(stripMarkdownCodeFencesInline(structured).trim())
        : structured
  } else {
    const stripped = stripMarkdownCodeFencesInline(rawText).trim()
    try {
      parsedJson = parsePlan(stripped)
    } catch (e) {
      console.warn("PLAN_JSON_PARSE_PRIMARY_FAILED, trying coerce:", e)
      parsedJson = coerceParsedPlanFromRawText(stripped)
    }
    if (parsedJson == null) {
      parsedJson = coerceParsedPlanFromRawText(stripped)
    }
  }

  if (parsedJson == null) {
    console.error("PLAN_JSON_PARSE_FAILED — 全部解包路径失败，注入知识图谱直接回答")
    return [...FALLBACK_TASK_LIST]
  }

  const rawJsonTasks = extractRawJsonTasks(parsedJson)
  const sanitizedTasks = forceAssembleTasksFromRaw(rawJsonTasks)

  const parsed = TaskListSchema.safeParse(sanitizedTasks)
  if (parsed.success) return parsed.data

  console.error("ZOD_ISSUES:", parsed.error.issues, "— 仍返回强制组装结果，不清空拓扑")
  return sanitizedTasks
}
