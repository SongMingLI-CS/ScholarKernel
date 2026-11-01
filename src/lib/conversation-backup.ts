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

/**
 * 恢复备份时的消息 id 分配器。
 *
 * id 会一路传到底：`chatMessageToCreateBody` 带上它，服务端
 * `POST /api/conversations/[id]/messages` 以 `where: { id }` 做 upsert。
 * **id 重复等于静默互相覆盖** —— 后一条消息把前一条顶掉，恢复出来的会话丢内容。
 *
 * 所以这里要保证两件事：
 * 1. 缺失的 id 一定拿到**唯一**值；
 * 2. 备份文件里自带的重复 id 被改写（保留首个出现的那条）。
 *
 * 坑：`crypto.randomUUID` 只在安全上下文（HTTPS / localhost）提供。
 * 自托管用 `http://<局域网IP>:3000` 访问时它是 `undefined`，
 * 原来的 `crypto.randomUUID?.() ?? String(Date.now())` 会让同一毫秒内的
 * 多条消息拿到完全相同的 id（实测 8 条只剩 1 个唯一 id）。
 */

type RandomSource = {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array) => Uint8Array
}

/** 进程内单调递增，保证同一毫秒内的多次生成也不会撞车。 */
let generatedIdCounter = 0

function randomSuffix(): string {
  const source = (globalThis as { crypto?: RandomSource }).crypto
  if (source) {
    if (typeof source.randomUUID === "function") {
      try {
        return source.randomUUID()
      } catch {
        // 某些实现会在非安全上下文抛错，继续退化
      }
    }
    if (typeof source.getRandomValues === "function") {
      try {
        const buf = new Uint8Array(8)
        source.getRandomValues(buf)
        return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
      } catch {
        // 同上
      }
    }
  }
  return Math.random().toString(36).slice(2, 10)
}

function nextGeneratedMessageId(): string {
  generatedIdCounter += 1
  return `msg_${Date.now().toString(36)}_${generatedIdCounter.toString(36)}_${randomSuffix()}`
}

export type MessageIdAllocator = { claim(raw: unknown): string }

export function createMessageIdAllocator(): MessageIdAllocator {
  const seen = new Set<string>()
  return {
    claim(raw: unknown): string {
      if (typeof raw === "string") {
        const trimmed = raw.trim()
        if (trimmed && !seen.has(trimmed)) {
          seen.add(trimmed)
          return trimmed
        }
      }
      let id = nextGeneratedMessageId()
      while (seen.has(id)) id = nextGeneratedMessageId()
      seen.add(id)
      return id
    },
  }
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
  // 分配器跨整个 payload 复用：id 是全局主键，跨会话也必须唯一
  const ids = createMessageIdAllocator()
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
        id: ids.claim(msg.id),
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
