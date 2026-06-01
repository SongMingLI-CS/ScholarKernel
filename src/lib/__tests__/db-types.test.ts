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
})
