import type { ConversationSummary } from "@/lib/db-types"
import type { ExportMetadata } from "@/lib/export-metadata"
import { buildExportMetadataMarkdown } from "@/lib/export-metadata"
import type { ChatMessage } from "@/store/useAgentStore"
import type { Lang } from "@/store/types"

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
}

/** Markdown 是行敏感的：标题/链接文字里的换行会直接改变文档结构。 */
function oneLine(text: string): string {
  return text.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[ \t]{2,}/g, " ").trim()
}

/** 链接文字里的方括号会提前闭合 `[text]`，必须转义。 */
function escapeMarkdownLinkText(text: string): string {
  return oneLine(text).replace(/[\\[\]]/g, (c) => `\\${c}`)
}

/**
 * URL 里的括号/空格/尖括号会提前闭合 `(url)`，统一百分号编码。
 * 注意 `encodeURIComponent` **不转义** `( ) ! * ' ~`，括号必须显式映射。
 */
const LINK_URL_ESCAPES: Record<string, string> = {
  "(": "%28",
  ")": "%29",
  "<": "%3C",
  ">": "%3E",
  "\\": "%5C",
}

function encodeMarkdownLinkUrl(url: string): string {
  return oneLine(url).replace(/[\s()<>\\]/g, (c) => LINK_URL_ESCAPES[c] ?? encodeURIComponent(c))
}

export function formatConversationAsMarkdown(
  title: string,
  messages: ChatMessage[],
  meta?: ExportMetadata,
  lang: Lang = "zh"
): string {
  const headerMeta = meta ? buildExportMetadataMarkdown(meta, lang) : ""
  const lines: string[] = [`# ${oneLine(title) || "对话"}`, "", ...headerMeta.split("\n").filter((l) => l.length > 0), ""]

  for (const m of messages) {
    if (m.role === "system" && !m.content.trim()) continue
    lines.push(`## ${ROLE_LABEL[m.role]}`, "", m.content.trim(), "")
    if (m.role === "assistant" && m.sources && m.sources.length > 0) {
      lines.push("### 引用来源", "")
      for (const s of m.sources) {
        lines.push(`- [${escapeMarkdownLinkText(s.title)}](${encodeMarkdownLinkUrl(s.url)})`)
      }
      lines.push("")
    }
  }

  return lines.join("\n").trimEnd() + "\n"
}

export function filterConversationsByQuery(
  conversations: ConversationSummary[],
  query: string
): ConversationSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return conversations
  return conversations.filter((c) => c.title.toLowerCase().includes(q))
}

/** Windows 设备名不能作文件名（带不带扩展名都不行）。 */
const RESERVED_BASENAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

/** 文件名主体上限，给扩展名和可能的 " (1)" 后缀留余量。 */
const MAX_FILENAME_BASE_CHARS = 100

/**
 * 按 UTF-16 长度截断（文件系统限制的就是这个），但不能留下半个代理对 ——
 * 否则会得到一个孤立的高位代理，写盘时变成乱码字符。
 */
function truncateFileNameBase(value: string, limit: number): string {
  if (value.length <= limit) return value
  let out = value.slice(0, limit)
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1)
  return out
}

export function sanitizeExportFilename(title: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
  // 开头不能是点（Unix 隐藏文件），结尾不能是点或空格（Windows 会静默截掉）
  const trimmed = cleaned.replace(/^\.+/, "").replace(/[. ]+$/, "").trim()
  // 先截断、再去尾部点（截断可能刚好停在点上）
  let base = truncateFileNameBase(trimmed, MAX_FILENAME_BASE_CHARS).replace(/[. ]+$/, "")
  if (!base) return "scholarkernel-conversation.md"
  const stem = base.split(".")[0]!.toLowerCase()
  if (RESERVED_BASENAMES.has(stem)) base = `_${truncateFileNameBase(base, MAX_FILENAME_BASE_CHARS - 1)}`
  return `${base}.md`
}

export function downloadTextFile(filename: string, content: string, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through
    }
  }
  if (typeof document === "undefined") return false
  const ta = document.createElement("textarea")
  ta.value = text
  ta.style.position = "fixed"
  ta.style.opacity = "0"
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}

const DEFAULT_TITLES = new Set(["新对话", "new chat", "new conversation"])

export function deriveConversationTitle(firstUserMessage: string, maxLen = 32): string {
  const s = firstUserMessage.trim().replace(/\s+/g, " ")
  if (!s) return "新对话"
  const oneLine = (s.split("\n")[0] ?? s).trim()
  if (oneLine.length <= maxLen) return oneLine
  return `${oneLine.slice(0, maxLen - 1)}…`
}

export function isDefaultConversationTitle(title: string): boolean {
  return DEFAULT_TITLES.has(title.trim().toLowerCase())
}

export function findLastRegenerablePair(
  messages: ChatMessage[]
): { userText: string; assistantId: string; trimBeforeIndex: number } | null {
  let assistantIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "assistant") {
      assistantIdx = i
      break
    }
  }
  if (assistantIdx < 0) return null

  let userText = ""
  for (let i = assistantIdx - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === "user" && m.content.trim()) {
      userText = m.content.trim()
      break
    }
  }
  if (!userText) return null

  const assistantId = messages[assistantIdx]!.id
  return { userText, assistantId, trimBeforeIndex: assistantIdx }
}
