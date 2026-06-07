import type { ChatMessage } from "@/store/useAgentStore"
import type { Lang, ProviderConfig, WorkflowNode } from "@/store/types"

/** Beijing / Singapore aligned export timezone (Vercel runs in UTC). */
export const EXPORT_TIMEZONE = "Asia/Shanghai"

export type ExportMetadata = {
  model: string
  retrievalDate: string
  exportedAt: string
}

export type ExportMetadataResolveInput = {
  lang?: Lang
  /** Active workspace provider (Models panel). */
  activeProvider?: Pick<ProviderConfig, "providerId" | "model">
  /** Last completed inference run for this conversation. */
  inferenceModel?: string | null
  /** Scholar Canvas or AgentJob completion time (ISO). */
  documentUpdatedAt?: string | null
  /** Workflow nodes — used for inferenceModel + searchCompletedAt. */
  workflowNodes?: WorkflowNode[]
  /** Chat messages — assistant sources as retrieval fallback. */
  messages?: ChatMessage[]
  /** Explicit override (e.g. conversation.model when persisted). */
  modelOverride?: string | null
  /** Explicit retrieval timestamp (ISO / epoch / Date). */
  retrievalAt?: string | number | Date | null
  /** Export instant; defaults to now. */
  exportedAt?: string | number | Date
}

const STALE_METADATA_LINE_RE =
  /^\s*(?:>\s*)?(?:\*\*)?(?:Model|模型|底层模型|Inference Model)(?:\*\*)?\s*[:：]\s*.+$/gim

const STALE_RETRIEVAL_LINE_RE =
  /^\s*(?:>\s*)?(?:\*\*)?(?:Retrieval Date|检索日期|检索时间|Search Date)(?:\*\*)?\s*[:：]\s*.+$/gim

const STALE_EXPORT_TIME_LINE_RE =
  /^\s*(?:>\s*)?(?:\*\*)?(?:导出时间|Exported(?: at)?|Export Time)(?:\*\*)?\s*[:：]\s*.+$/gim

export function formatExportDateTime(
  value: string | number | Date = new Date(),
  locale: "zh-CN" | "en-US" = "zh-CN"
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ""

  return new Intl.DateTimeFormat(locale, {
    timeZone: EXPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date)
}

function parseTimestamp(value: string | number | Date | null | undefined): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function latestSearchCompletedAt(nodes: WorkflowNode[] | undefined): Date | null {
  if (!nodes?.length) return null
  let best: Date | null = null
  for (const n of nodes) {
    if (n.type !== "research" && n.metadata?.["kind"] !== "search") continue
    if (n.status !== "done") continue
    const raw = n.metadata?.["searchCompletedAt"]
    const parsed =
      typeof raw === "string" || typeof raw === "number"
        ? parseTimestamp(raw)
        : raw instanceof Date
          ? raw
          : null
    if (!parsed) continue
    if (!best || parsed.getTime() > best.getTime()) best = parsed
  }
  return best
}

function latestInferenceModel(nodes: WorkflowNode[] | undefined): string | null {
  if (!nodes?.length) return null
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    if (!n || n.type !== "reasoning" || n.status !== "done") continue
    const raw = n.metadata?.["inferenceModel"]
    if (typeof raw === "string" && raw.trim()) return raw.trim()
  }
  return null
}

function latestSourcePublishedAt(messages: ChatMessage[] | undefined): Date | null {
  if (!messages?.length) return null
  let best: Date | null = null
  for (const m of messages) {
    if (m.role !== "assistant" || !m.sources?.length) continue
    for (const s of m.sources) {
      if (!s.publishedAt?.trim()) continue
      const parsed = parseTimestamp(s.publishedAt)
      if (!parsed) continue
      if (!best || parsed.getTime() > best.getTime()) best = parsed
    }
  }
  return best
}

export function resolveExportModel(input: ExportMetadataResolveInput): string {
  const override = input.modelOverride?.trim()
  if (override) return override

  const inference = input.inferenceModel?.trim()
  if (inference) return inference

  const fromWorkflow = latestInferenceModel(input.workflowNodes)
  if (fromWorkflow) return fromWorkflow

  const activeModel = input.activeProvider?.model?.trim()
  if (activeModel) return activeModel

  return "unknown"
}

export function resolveRetrievalTimestamp(input: ExportMetadataResolveInput): Date | null {
  const explicit = parseTimestamp(input.retrievalAt ?? null)
  if (explicit) return explicit

  const docAt = parseTimestamp(input.documentUpdatedAt ?? null)
  if (docAt) return docAt

  const searchAt = latestSearchCompletedAt(input.workflowNodes)
  if (searchAt) return searchAt

  return latestSourcePublishedAt(input.messages)
}

/** Remove LLM-generated or stale hardcoded metadata lines before re-injecting dynamic values. */
export function stripStaleExportMetadata(content: string): string {
  return content
    .replace(STALE_METADATA_LINE_RE, "")
    .replace(STALE_RETRIEVAL_LINE_RE, "")
    .replace(STALE_EXPORT_TIME_LINE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function buildExportMetadata(input: ExportMetadataResolveInput): ExportMetadata {
  const lang = input.lang ?? "zh"
  const locale = lang === "zh" ? "zh-CN" : "en-US"
  const exportedAtDate = parseTimestamp(input.exportedAt ?? new Date()) ?? new Date()
  const retrievalDateSource = resolveRetrievalTimestamp(input) ?? exportedAtDate

  return {
    model: resolveExportModel(input),
    retrievalDate: formatExportDateTime(retrievalDateSource, locale),
    exportedAt: formatExportDateTime(exportedAtDate, locale),
  }
}

export function buildExportMetadataMarkdown(meta: ExportMetadata, lang: Lang = "zh"): string {
  if (lang === "zh") {
    return [
      `> 模型：${meta.model}`,
      `> 检索日期：${meta.retrievalDate}`,
      `> 导出时间：${meta.exportedAt}`,
      "",
    ].join("\n")
  }
  return [
    `> Model: ${meta.model}`,
    `> Retrieval Date: ${meta.retrievalDate}`,
    `> Exported: ${meta.exportedAt}`,
    "",
  ].join("\n")
}

export function buildExportMetadataHtml(meta: ExportMetadata, lang: Lang = "zh"): string {
  if (lang === "zh") {
    return `<p class="meta">模型：${escapeHtml(meta.model)} · 检索日期：${escapeHtml(meta.retrievalDate)} · 导出时间：${escapeHtml(meta.exportedAt)}</p>`
  }
  return `<p class="meta">Model: ${escapeHtml(meta.model)} · Retrieval Date: ${escapeHtml(meta.retrievalDate)} · Exported: ${escapeHtml(meta.exportedAt)}</p>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

export function prependExportMetadata(content: string, meta: ExportMetadata, lang: Lang = "zh"): string {
  const body = stripStaleExportMetadata(content)
  const header = buildExportMetadataMarkdown(meta, lang)
  return body ? `${header}${body}\n` : `${header.trimEnd()}\n`
}

export type ExportStoreSnapshot = {
  providers: { active: ProviderConfig }
  inference: {
    streaming: { model: string } | null
    last: { model: string } | null
  }
  workflow: { nodes: WorkflowNode[] }
  chat?: { messages: ChatMessage[] }
  canvas?: { activeDocument: { updatedAt: string } | null }
  settings: { lang: Lang }
}

/** Gather export metadata from current workspace / conversation context. */
export function gatherExportMetadataFromStore(
  st: ExportStoreSnapshot,
  opts?: { documentUpdatedAt?: string | null; modelOverride?: string | null; retrievalAt?: string | null }
): ExportMetadata {
  const inferenceModel =
    opts?.modelOverride?.trim() ||
    st.inference.streaming?.model?.trim() ||
    st.inference.last?.model?.trim() ||
    null

  return buildExportMetadata({
    lang: st.settings.lang,
    activeProvider: st.providers.active,
    inferenceModel,
    workflowNodes: st.workflow.nodes,
    messages: st.chat?.messages,
    documentUpdatedAt: opts?.documentUpdatedAt ?? st.canvas?.activeDocument?.updatedAt ?? null,
    retrievalAt: opts?.retrievalAt ?? null,
  })
}
