import type { Message as PrismaMessage } from "../../generated/prisma/client"

import type { ChatMessage, RuntimeKeys, ThemeMode } from "@/store/useAgentStore"

/** Sidebar list item — no messages payload (JSON dates are ISO strings) */
export type ConversationSummary = {
  id: string
  title: string
  isPinned: boolean
  createdAt: string
  updatedAt: string
}

export type TemplateBootstrapResponse = {
  templateId: string
  systemPrompt: string
  initialAgents: import("@/store/types").WorkflowNode[]
  jobId: string
}

export type CreateConversationResponse = ConversationSummary & {
  templateBootstrap?: TemplateBootstrapResponse
}

export type PaginatedConversations = {
  items: ConversationSummary[]
  nextCursor: string | null
  hasMore: boolean
}

export type MessageMetadata = {
  sources?: ChatMessage["sources"]
}

/** Full conversation with messages for chat panel hydration */
export type ConversationDetail = ConversationSummary & {
  messages: Array<Omit<PrismaMessage, "createdAt"> & { createdAt: string }>
  messagesNextCursor?: string | null
  messagesHasMore?: boolean
}

export type SettingsResponse = {
  userId: string
  theme: ThemeMode
  runtimeKeys: RuntimeKeys | null
  updatedAt: string
}

export type SettingsPatchBody = {
  theme?: ThemeMode
  runtimeKeys?: Partial<RuntimeKeys> | null
}

export type ConversationPatchBody = {
  title?: string
  isPinned?: boolean
}

export type CreateMessageBody = {
  id?: string
  role: ChatMessage["role"]
  content: string
  metadata?: MessageMetadata | null
}

export type ScholarDocument = {
  id: string
  conversationId: string
  title: string
  content: string
  version: number
  createdAt: string
  updatedAt: string
}

export type CreateDocumentBody = {
  title?: string
  content?: string
}

export type PatchDocumentBody = {
  title?: string
  content?: string
}

function parseMessageMetadata(raw: unknown): MessageMetadata {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const sources = rec.sources
  if (!Array.isArray(sources)) return {}
  const parsed = sources
    .map((s) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return null
      const item = s as Record<string, unknown>
      const title = typeof item.title === "string" ? item.title : ""
      const url = typeof item.url === "string" ? item.url : ""
      if (!title || !url) return null
      return {
        title,
        url,
        ...(typeof item.snippet === "string" ? { snippet: item.snippet } : {}),
        ...(typeof item.publishedAt === "string" ? { publishedAt: item.publishedAt } : {}),
        ...(typeof item.source_id === "string" ? { source_id: item.source_id } : {}),
      }
    })
    .filter((s): s is NonNullable<typeof s> => s != null)
  return parsed.length ? { sources: parsed } : {}
}

export function prismaMessageToChat(m: {
  id: string
  role: string
  content: string
  metadata?: unknown
}): ChatMessage {
  const meta = parseMessageMetadata(m.metadata)
  return {
    id: m.id,
    role: m.role as ChatMessage["role"],
    content: m.content,
    ...(meta.sources?.length ? { sources: meta.sources } : {}),
  }
}

export function chatMessageToCreateBody(m: ChatMessage): CreateMessageBody {
  const metadata: MessageMetadata | undefined = m.sources?.length ? { sources: m.sources } : undefined
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(metadata ? { metadata } : {}),
  }
}
