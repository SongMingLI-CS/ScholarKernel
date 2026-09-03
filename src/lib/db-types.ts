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
  evidenceStatuses?: ChatMessage["evidenceStatuses"]
}

/** Full conversation with messages for chat panel hydration */
export type ConversationDetail = ConversationSummary & {
  messages: Array<Omit<PrismaMessage, "createdAt"> & { createdAt: string }>
  canvasDocuments: ScholarDocument[]
  messagesNextCursor?: string | null
  messagesHasMore?: boolean
}

export type SettingsResponse = {
  userId: string
  theme: ThemeMode
  runtimeKeyStatus: Record<import("@/store/types").RuntimeKeyField, boolean>
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

export function selectLatestCanvasDocument(
  documents: ScholarDocument[] | null | undefined
): ScholarDocument | null {
  if (!documents?.length) return null
  return [...documents].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )[0] ?? null
}

function parseMessageMetadata(raw: unknown): MessageMetadata {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const rec = raw as Record<string, unknown>
  const sources = rec.sources
  const parsedSources = Array.isArray(sources) ? sources
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
    .filter((s): s is NonNullable<typeof s> => s != null) : []
  const states = new Set(["loaded", "missing", "failed", "degraded"])
  const kinds = new Set(["library", "search", "file"])
  const evidenceStatuses = Array.isArray(rec.evidenceStatuses)
    ? rec.evidenceStatuses
        .map((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return null
          const item = value as Record<string, unknown>
          if (
            typeof item.id !== "string" ||
            typeof item.label !== "string" ||
            typeof item.kind !== "string" ||
            !kinds.has(item.kind) ||
            typeof item.state !== "string" ||
            !states.has(item.state)
          ) return null
          return {
            id: item.id,
            label: item.label,
            kind: item.kind as NonNullable<ChatMessage["evidenceStatuses"]>[number]["kind"],
            state: item.state as NonNullable<ChatMessage["evidenceStatuses"]>[number]["state"],
            ...(typeof item.detail === "string" ? { detail: item.detail } : {}),
            ...(typeof item.sourceCount === "number" ? { sourceCount: item.sourceCount } : {}),
            ...(typeof item.nodeId === "string" ? { nodeId: item.nodeId } : {}),
          }
        })
        .filter((status): status is NonNullable<typeof status> => status != null)
    : []
  return {
    ...(parsedSources.length ? { sources: parsedSources } : {}),
    ...(evidenceStatuses.length ? { evidenceStatuses } : {}),
  }
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
    ...(meta.evidenceStatuses?.length ? { evidenceStatuses: meta.evidenceStatuses } : {}),
  }
}

export function chatMessageToCreateBody(m: ChatMessage): CreateMessageBody {
  const metadata: MessageMetadata | undefined = m.sources?.length || m.evidenceStatuses?.length
    ? {
        ...(m.sources?.length ? { sources: m.sources } : {}),
        ...(m.evidenceStatuses?.length ? { evidenceStatuses: m.evidenceStatuses } : {}),
      }
    : undefined
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(metadata ? { metadata } : {}),
  }
}
