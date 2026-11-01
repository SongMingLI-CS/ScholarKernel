import { describe, expect, it } from "vitest"

import { chatMessageToCreateBody, prismaMessageToChat } from "@/lib/db-types"

describe("message metadata", () => {
  it("round-trips sources through metadata", () => {
    const chat = {
      id: "m1",
      role: "assistant" as const,
      content: "answer",
      sources: [{ title: "Paper A", url: "https://example.com/a", snippet: "abs" }],
    }
    const body = chatMessageToCreateBody(chat)
    expect(body.metadata?.sources).toHaveLength(1)
    const back = prismaMessageToChat({
      id: chat.id,
      role: chat.role,
      content: chat.content,
      metadata: body.metadata,
    })
    expect(back.sources?.[0]?.title).toBe("Paper A")
  })

  it("ignores invalid metadata", () => {
    const back = prismaMessageToChat({
      id: "m2",
      role: "assistant",
      content: "x",
      metadata: { sources: [{ title: "", url: "" }] },
    })
    expect(back.sources).toBeUndefined()
  })

  /**
   * 来源 url 会直接进 `<a href={s.url} target="_blank">`（chat-panel.tsx 的 SourcesFoldout）。
   * metadata 有两个不受信任的入口：
   * 1. `POST /api/conversations/[id]/messages` 的 `body.metadata`（原样写库，只做了 typeof 判断）；
   * 2. 备份 JSON 文件。
   * 而 `parseMessageMetadata` 只校验 `typeof url === "string"`，不看协议。
   */
  it("drops non-http(s) source urls", () => {
    const back = prismaMessageToChat({
      id: "m3",
      role: "assistant",
      content: "x",
      metadata: {
        sources: [
          { title: "evil", url: "javascript:alert(1)" },
          { title: "ok", url: "https://example.com/a" },
          { title: "data", url: "data:text/html,<script>alert(1)</script>" },
        ],
      },
    })
    expect(back.sources?.map((s) => s.url)).toEqual(["https://example.com/a"])
  })
})
