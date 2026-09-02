import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

import type { ConversationSummary } from "@/lib/db-types"
import type { ChatMessage } from "@/store/types"
import {
  OPTIMISTIC_CONV_TITLE,
  TEMP_CONV_PREFIX,
  TEMP_MSG_PREFIX,
  createOptimisticConversation,
  createTempConversationId,
  createTempMessageId,
  isTempConversationId,
  isTempMessageId,
  reduceOptimisticConversationState,
  reconcileConversationList,
  rollbackChatMessages,
  rollbackConversationList,
} from "@/lib/optimistic-ui"

describe("optimistic-ui", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("creates temp conversation ids with prefix", () => {
    const id = createTempConversationId()
    expect(id).toBe(`${TEMP_CONV_PREFIX}00000000-0000-4000-8000-000000000001`)
    expect(isTempConversationId(id)).toBe(true)
    expect(isTempConversationId("real-uuid")).toBe(false)
  })

  it("creates temp message ids with prefix", () => {
    const id = createTempMessageId()
    expect(id.startsWith(TEMP_MSG_PREFIX)).toBe(true)
    expect(isTempMessageId(id)).toBe(true)
  })

  it("builds optimistic conversation with default academic title", () => {
    const tempId = createTempConversationId()
    const conv = createOptimisticConversation(tempId)
    expect(conv.id).toBe(tempId)
    expect(conv.title).toBe(OPTIMISTIC_CONV_TITLE)
    expect(conv.isPinned).toBe(false)
    expect(conv.createdAt).toBe(conv.updatedAt)
  })

  it("reconciles temp conversation to server record", () => {
    const tempId = `${TEMP_CONV_PREFIX}a`
    const optimistic = createOptimisticConversation(tempId)
    const real: ConversationSummary = {
      id: "pg-real-id",
      title: OPTIMISTIC_CONV_TITLE,
      isPinned: false,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    }
    const next = reconcileConversationList([optimistic], tempId, real)
    expect(next).toHaveLength(1)
    expect(next[0]?.id).toBe("pg-real-id")
  })

  it("rolls back failed optimistic conversation", () => {
    const tempId = `${TEMP_CONV_PREFIX}b`
    const optimistic = createOptimisticConversation(tempId)
    const kept: ConversationSummary = {
      id: "existing",
      title: "已有对话",
      isPinned: false,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    }
    const next = rollbackConversationList([optimistic, kept], tempId)
    expect(next).toEqual([kept])
  })

  it("rolls back optimistic chat messages by id", () => {
    const msgs: ChatMessage[] = [
      { id: `${TEMP_MSG_PREFIX}u`, role: "user", content: "hello" },
      { id: `${TEMP_MSG_PREFIX}a`, role: "assistant", content: "" },
      { id: "keep", role: "user", content: "stay" },
    ]
    const next = rollbackChatMessages(msgs, [`${TEMP_MSG_PREFIX}u`, `${TEMP_MSG_PREFIX}a`])
    expect(next).toEqual([{ id: "keep", role: "user", content: "stay" }])
  })

  describe("reduceOptimisticConversationState", () => {
    const existing: ConversationSummary = {
      id: "existing",
      title: "已有对话",
      isPinned: false,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    }

    it("creates optimistic row and activates temp id instantly", () => {
      const tempId = `${TEMP_CONV_PREFIX}fast`
      const optimistic = createOptimisticConversation(tempId)
      const next = reduceOptimisticConversationState(
        { items: [existing], currentId: "existing" },
        { type: "create", tempId, optimistic }
      )
      expect(next.currentId).toBe(tempId)
      expect(next.items[0]?.id).toBe(tempId)
      expect(next.items).toHaveLength(2)
    })

    it("reconciles temp id to postgres uuid without user-visible gap", () => {
      const tempId = `${TEMP_CONV_PREFIX}reconcile`
      const optimistic = createOptimisticConversation(tempId)
      const created = reduceOptimisticConversationState(
        { items: [existing], currentId: existing.id },
        { type: "create", tempId, optimistic }
      )
      const real: ConversationSummary = {
        id: "pg-uuid-99",
        title: OPTIMISTIC_CONV_TITLE,
        isPinned: false,
        createdAt: "2026-06-02T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      }
      const reconciled = reduceOptimisticConversationState(created, { type: "reconcile", tempId, real })
      expect(reconciled.currentId).toBe("pg-uuid-99")
      expect(reconciled.items.some((c) => c.id === tempId)).toBe(false)
      expect(reconciled.items[0]?.id).toBe("pg-uuid-99")
    })

    it("rolls back temp conversation after API 500 and restores previous selection", () => {
      const tempA = `${TEMP_CONV_PREFIX}a`
      const tempB = `${TEMP_CONV_PREFIX}b`
      const optA = createOptimisticConversation(tempA)
      const optB = createOptimisticConversation(tempB)

      let state = reduceOptimisticConversationState(
        { items: [existing], currentId: existing.id },
        { type: "create", tempId: tempA, optimistic: optA }
      )
      state = reduceOptimisticConversationState(state, { type: "create", tempId: tempB, optimistic: optB })
      expect(state.currentId).toBe(tempB)

      state = reduceOptimisticConversationState(state, { type: "rollback", tempId: tempB })
      expect(state.currentId).toBe(tempA)
      expect(state.items.some((c) => c.id === tempB)).toBe(false)

      state = reduceOptimisticConversationState(state, { type: "rollback", tempId: tempA })
      expect(state.currentId).toBe(existing.id)
      expect(state.items).toEqual([existing])
    })
  })
})
