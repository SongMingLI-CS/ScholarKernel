import type { ConversationSummary } from "@/lib/db-types"
import type { ChatMessage } from "@/store/useAgentStore"

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "用户",
  assistant: "助手",
  system: "系统",
}

export function formatConversationAsMarkdown(title: string, messages: ChatMessage[]): string {
  const lines: string[] = [`# ${title.trim() || "对话"}`, "", `> 导出时间：${new Date().toISOString()}`, ""]

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
