import type {
  ConversationDetail,
  ConversationSummary,
  CreateMessageBody,
  PaginatedConversations,
  SettingsPatchBody,
  SettingsResponse,
} from "@/lib/db-types"
import { chatMessageToCreateBody } from "@/lib/db-types"
import type { ChatMessage, RuntimeKeys, ThemeMode } from "@/store/useAgentStore"

async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error ?? `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function fetchConversations(): Promise<ConversationSummary[]> {
  return apiFetch<ConversationSummary[]>("/api/conversations")
}

export async function fetchConversationsPage(input?: {
  limit?: number
  cursor?: string | null
}): Promise<PaginatedConversations> {
  const qp = new URLSearchParams()
  qp.set("limit", String(input?.limit ?? 50))
  if (input?.cursor) qp.set("cursor", input.cursor)
  return apiFetch<PaginatedConversations>(`/api/conversations?${qp.toString()}`)
}

export async function createConversation(): Promise<ConversationSummary> {
  return apiFetch<ConversationSummary>("/api/conversations", { method: "POST" })
}

export async function fetchConversation(
  id: string,
  opts?: { msgLimit?: number; msgCursor?: string | null }
): Promise<ConversationDetail> {
  const qp = new URLSearchParams()
  if (opts?.msgLimit) qp.set("msgLimit", String(opts.msgLimit))
  if (opts?.msgCursor) qp.set("msgCursor", opts.msgCursor)
  const qs = qp.toString()
  return apiFetch<ConversationDetail>(`/api/conversations/${id}${qs ? `?${qs}` : ""}`)
}

export async function patchConversation(
  id: string,
  patch: { title?: string; isPinned?: boolean }
): Promise<ConversationSummary> {
  return apiFetch<ConversationSummary>(`/api/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function deleteConversation(id: string): Promise<void> {
  await apiFetch<void>(`/api/conversations/${id}`, { method: "DELETE" })
}

export async function appendMessage(conversationId: string, message: CreateMessageBody): Promise<void> {
  await apiFetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(message),
  })
}

export async function clearConversationMessages(conversationId: string): Promise<void> {
  await apiFetch<void>(`/api/conversations/${conversationId}/messages`, { method: "DELETE" })
}

export async function upsertMessageContent(
  conversationId: string,
  message: ChatMessage
): Promise<void> {
  await appendMessage(conversationId, chatMessageToCreateBody(message))
}

export async function createDocument(
  conversationId: string,
  body: { title?: string; content?: string }
): Promise<import("@/lib/db-types").ScholarDocument> {
  return apiFetch(`/api/conversations/${conversationId}/documents`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function patchDocument(
  conversationId: string,
  docId: string,
  patch: { title?: string; content?: string }
): Promise<import("@/lib/db-types").ScholarDocument> {
  return apiFetch(`/api/conversations/${conversationId}/documents/${docId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function fetchSettings(): Promise<SettingsResponse> {
  return apiFetch<SettingsResponse>("/api/settings")
}

export async function patchSettings(patch: SettingsPatchBody): Promise<SettingsResponse> {
  return apiFetch<SettingsResponse>("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function syncRuntimeKeysToCloud(keys: Partial<RuntimeKeys> | null): Promise<void> {
  await patchSettings({ runtimeKeys: keys })
}

export async function syncThemeToCloud(theme: ThemeMode): Promise<void> {
  await patchSettings({ theme })
}
