import type {
  ConversationDetail,
  ConversationSummary,
  CreateMessageBody,
  SettingsPatchBody,
  SettingsResponse,
} from "@/lib/db-types"
import type { ChatMessage, RuntimeKeys, ThemeMode } from "@/store/useAgentStore"

async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
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

export async function createConversation(): Promise<ConversationSummary> {
  return apiFetch<ConversationSummary>("/api/conversations", { method: "POST" })
}

export async function fetchConversation(id: string): Promise<ConversationDetail> {
  return apiFetch<ConversationDetail>(`/api/conversations/${id}`)
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

export async function upsertMessageContent(
  conversationId: string,
  message: ChatMessage
): Promise<void> {
  await appendMessage(conversationId, {
    id: message.id,
    role: message.role,
    content: message.content,
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
