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

export function formatConversationAsMarkdown(
  title: string,
  messages: ChatMessage[],
  meta?: ExportMetadata,
  lang: Lang = "zh"
): string {
  const headerMeta = meta ? buildExportMetadataMarkdown(meta, lang) : ""
  const lines: string[] = [`# ${title.trim() || "对话"}`, "", ...headerMeta.split("\n").filter((l) => l.length > 0), ""]

  for (const m of messages) {
    if (m.role === "system" && !m.content.trim()) continue
    lines.push(`## ${ROLE_LABEL[m.role]}`, "", m.content.trim(), "")
    if (m.role === "assistant" && m.sources && m.sources.length > 0) {
      lines.push("### 引用来源", "")
      for (const s of m.sources) {
        lines.push(`- [${s.title}](${s.url})`)
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

export function sanitizeExportFilename(title: string): string {
  const base = title.trim().replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, " ").trim()
  return `${base || "scholarkernel-conversation"}.md`
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

const DEFAULT_TITLES = new Set(["新对话", "新学术对话...", "new chat", "new conversation"])

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
