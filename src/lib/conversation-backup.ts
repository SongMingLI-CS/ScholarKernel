import type { ChatMessage } from "@/store/types"

export type ConversationBackupEntry = {
  title: string
  isPinned: boolean
  messages: ChatMessage[]
}

export type ConversationBackupPayloadV1 = {
  v: 1
  kind: "sk-conversations"
  exportedAt: number
  conversations: ConversationBackupEntry[]
}

export function buildConversationBackupPayload(conversations: ConversationBackupEntry[]): ConversationBackupPayloadV1 {
  return {
    v: 1,
    kind: "sk-conversations",
    exportedAt: Date.now(),
    conversations: conversations.map((c) => ({
      title: c.title.trim() || "新对话",
      isPinned: Boolean(c.isPinned),
      messages: c.messages
        .filter((m) => m.role === "user" || m.role === "assistant" || (m.role === "system" && m.content.trim()))
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          ...(m.sources?.length ? { sources: m.sources } : {}),
        })),
    })),
  }
}

export function parseConversationBackupPayload(raw: unknown): ConversationBackupPayloadV1 | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (rec.v !== 1 || rec.kind !== "sk-conversations") return null
  if (!Array.isArray(rec.conversations)) return null

  const conversations: ConversationBackupEntry[] = []
  for (const item of rec.conversations) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const c = item as Record<string, unknown>
    const title = typeof c.title === "string" ? c.title : "新对话"
    const isPinned = Boolean(c.isPinned)
    if (!Array.isArray(c.messages)) continue
    const messages: ChatMessage[] = []
    for (const m of c.messages) {
      if (!m || typeof m !== "object" || Array.isArray(m)) continue
      const msg = m as Record<string, unknown>
      const role = msg.role
      const content = msg.content
      if (role !== "user" && role !== "assistant" && role !== "system") continue
      if (typeof content !== "string") continue
      messages.push({
        id: typeof msg.id === "string" ? msg.id : crypto.randomUUID?.() ?? String(Date.now()),
        role,
        content,
        ...(Array.isArray(msg.sources) ? { sources: msg.sources as ChatMessage["sources"] } : {}),
      })
    }
    conversations.push({ title, isPinned, messages })
  }

  if (!conversations.length) return null
  return {
    v: 1,
    kind: "sk-conversations",
    exportedAt: typeof rec.exportedAt === "number" ? rec.exportedAt : Date.now(),
    conversations,
  }
}
