import type { ConversationSummary } from "@/lib/db-types"
import type { ChatMessage } from "@/store/types"

export const TEMP_CONV_PREFIX = "temp_conv_"
export const TEMP_MSG_PREFIX = "temp_msg_"

export const OPTIMISTIC_CONV_TITLE = "新学术对话..."

export function createTempConversationId(): string {
  return `${TEMP_CONV_PREFIX}${crypto.randomUUID()}`
}

export function createTempMessageId(): string {
  return `${TEMP_MSG_PREFIX}${crypto.randomUUID()}`
}

export function isTempConversationId(id: string): boolean {
  return id.startsWith(TEMP_CONV_PREFIX)
}

export function isTempMessageId(id: string): boolean {
  return id.startsWith(TEMP_MSG_PREFIX)
}

export function createOptimisticConversation(
  id: string,
  title = OPTIMISTIC_CONV_TITLE
): ConversationSummary {
  const now = new Date().toISOString()
  return {
    id,
    title,
    isPinned: false,
    createdAt: now,
    updatedAt: now,
  }
}

/** Replace a temp conversation row with the server record; dedupe by real id. */
export function reconcileConversationList(
  items: ConversationSummary[],
  tempId: string,
  real: ConversationSummary
): ConversationSummary[] {
  const withoutTemp = items.filter((c) => c.id !== tempId && c.id !== real.id)
  return [real, ...withoutTemp]
}

/** Remove a failed optimistic conversation from the sidebar list. */
export function rollbackConversationList(
  items: ConversationSummary[],
  tempId: string
): ConversationSummary[] {
  return items.filter((c) => c.id !== tempId)
}

/** Remove optimistic messages after a persist failure. */
export function rollbackChatMessages(messages: ChatMessage[], ids: readonly string[]): ChatMessage[] {
  const drop = new Set(ids)
  return messages.filter((m) => !drop.has(m.id))
}

export type OptimisticConversationState = {
  items: ConversationSummary[]
  currentId: string | null
}

export type OptimisticConversationEvent =
  | { type: "create"; tempId: string; optimistic: ConversationSummary }
  | { type: "reconcile"; tempId: string; real: ConversationSummary }
  | { type: "rollback"; tempId: string }

/** Pure reducer for sidebar optimistic conversation lifecycle (testable). */
export function reduceOptimisticConversationState(
  state: OptimisticConversationState,
  event: OptimisticConversationEvent
): OptimisticConversationState {
  switch (event.type) {
    case "create":
      return {
        items: [event.optimistic, ...state.items.filter((c) => c.id !== event.tempId)],
        currentId: event.tempId,
      }
    case "reconcile": {
      const wasCurrent = state.currentId === event.tempId
      return {
        items: reconcileConversationList(state.items, event.tempId, event.real),
        currentId: wasCurrent ? event.real.id : state.currentId,
      }
    }
    case "rollback": {
      const wasCurrent = state.currentId === event.tempId
      const items = rollbackConversationList(state.items, event.tempId)
      return {
        items,
        currentId: wasCurrent ? (items[0]?.id ?? null) : state.currentId,
      }
    }
    default:
      return state
  }
}

export function replaceConversationIdInUrl(tempId: string, realId: string): void {
  if (typeof window === "undefined") return
  const url = new URL(window.location.href)
  if (url.searchParams.get("c") !== tempId) return
  url.searchParams.set("c", realId)
  window.history.replaceState(null, "", url.toString())
}
