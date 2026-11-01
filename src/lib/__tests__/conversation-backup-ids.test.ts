import { afterEach, describe, expect, it, vi } from "vitest"

import { parseConversationBackupPayload } from "../conversation-backup"

/**
 * 恢复备份时，消息 id 会一路传到底：`chatMessageToCreateBody` 带上 `id`，
 * 服务端 `POST /api/conversations/[id]/messages` 把它当主键做 `upsert`
 * （`where: { id: messageId }`）。
 *
 * 所以**重复 id 等于静默覆盖** —— 后一条消息会把前一条顶掉，恢复出来的会话少内容。
 * 原实现的兜底是 `crypto.randomUUID?.() ?? String(Date.now())`：
 *
 * 1. `crypto.randomUUID` 只在安全上下文（HTTPS / localhost）提供，
 *    自托管用 `http://<局域网IP>:3000` 访问时它是 `undefined`；
 * 2. 于是同一毫秒内解析的多条消息拿到**完全相同**的 id。
 */

function payload(messages: Array<Record<string, unknown>>) {
  return { v: 1, kind: "sk-conversations", exportedAt: 0, conversations: [{ title: "t", isPinned: false, messages }] }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("恢复备份时的消息 id 唯一性", () => {
  it("缺少 id 的多条消息各自拿到唯一 id", () => {
    const parsed = parseConversationBackupPayload(
      payload([
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
        { role: "user", content: "c" },
        { role: "assistant", content: "d" },
        { role: "user", content: "e" },
      ])
    )
    const ids = parsed!.conversations[0]!.messages.map((m) => m.id)
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("randomUUID 不可用时仍然唯一（http 自托管场景）", () => {
    vi.stubGlobal("crypto", {})
    const parsed = parseConversationBackupPayload(
      payload(Array.from({ length: 8 }, (_, i) => ({ role: "user", content: `m${i}` })))
    )
    const ids = parsed!.conversations[0]!.messages.map((m) => m.id)
    expect(new Set(ids).size).toBe(8)
  })

  it("crypto 整体不存在时不抛错且唯一", () => {
    vi.stubGlobal("crypto", undefined)
    expect(() =>
      parseConversationBackupPayload(payload([{ role: "user", content: "a" }, { role: "user", content: "b" }]))
    ).not.toThrow()
    const parsed = parseConversationBackupPayload(
      payload([{ role: "user", content: "a" }, { role: "user", content: "b" }])
    )
    const ids = parsed!.conversations[0]!.messages.map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
  })

  it("备份文件内自带的重复 id 被改写，避免 upsert 互相覆盖", () => {
    const parsed = parseConversationBackupPayload(
      payload([
        { id: "dup", role: "user", content: "a" },
        { id: "dup", role: "assistant", content: "b" },
        { id: "keep", role: "user", content: "c" },
      ])
    )
    const ids = parsed!.conversations[0]!.messages.map((m) => m.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe("dup")
    expect(ids[2]).toBe("keep")
  })

  it("合法且不重复的 id 原样保留", () => {
    const parsed = parseConversationBackupPayload(
      payload([
        { id: "m1", role: "user", content: "a" },
        { id: "m2", role: "assistant", content: "b" },
      ])
    )
    expect(parsed!.conversations[0]!.messages.map((m) => m.id)).toEqual(["m1", "m2"])
  })
})

/**
 * 备份文件是第二个不受信任的 sources 入口：原来直接 `msg.sources as ChatMessage["sources"]`
 * 强转，`javascript:` 的 url 会原样进前端 `<a href>`。
 */
describe("恢复备份时的来源清洗", () => {
  it("丢弃备份文件里的危险协议", () => {
    const parsed = parseConversationBackupPayload(
      payload([
        {
          id: "m1",
          role: "assistant",
          content: "a",
          sources: [
            { title: "evil", url: "javascript:alert(1)" },
            { title: "ok", url: "https://a.com/1" },
          ],
        },
      ])
    )
    expect(parsed!.conversations[0]!.messages[0]!.sources?.map((s) => s.url)).toEqual(["https://a.com/1"])
  })

  it("没有安全来源时不留下空的 sources 字段", () => {
    const parsed = parseConversationBackupPayload(
      payload([{ id: "m1", role: "assistant", content: "a", sources: [{ title: "x", url: "data:text/html,1" }] }])
    )
    expect(parsed!.conversations[0]!.messages[0]!.sources).toBeUndefined()
  })
})
