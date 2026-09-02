import { describe, expect, it } from "vitest"

import { selectLatestCanvasDocument } from "@/lib/db-types"

describe("Canvas conversation recovery", () => {
  it("selects the latest server document and leaves empty conversations closed", () => {
    const docs = [
      {
        id: "new",
        conversationId: "c1",
        title: "Latest",
        content: "new body",
        version: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
      },
      {
        id: "old",
        conversationId: "c1",
        title: "Old",
        content: "old body",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]
    expect(selectLatestCanvasDocument(docs)?.id).toBe("new")
    expect(selectLatestCanvasDocument([])).toBeNull()
    expect(selectLatestCanvasDocument(undefined)).toBeNull()
  })
})
