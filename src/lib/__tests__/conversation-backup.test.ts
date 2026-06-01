import { describe, expect, it } from "vitest"

import {
  buildConversationBackupPayload,
  parseConversationBackupPayload,
  type ConversationBackupEntry,
} from "@/lib/conversation-backup"

describe("conversation-backup", () => {
  it("round-trips backup payload v1", () => {
    const entries: ConversationBackupEntry[] = [
      {
        title: "Test",
        isPinned: true,
        messages: [{ id: "m1", role: "user", content: "hi" }],
      },
    ]
    const payload = buildConversationBackupPayload(entries)
    const parsed = parseConversationBackupPayload(payload)
    expect(parsed?.conversations).toHaveLength(1)
    expect(parsed?.conversations[0]?.title).toBe("Test")
    expect(parsed?.conversations[0]?.messages[0]?.content).toBe("hi")
  })

  it("rejects invalid payload", () => {
    expect(parseConversationBackupPayload(null)).toBeNull()
    expect(parseConversationBackupPayload({ v: 2 })).toBeNull()
  })
})
