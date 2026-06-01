import { describe, expect, it } from "vitest"

import { formatFileAttachmentBlock, isLikelyTextFile } from "@/lib/browser-file"

describe("browser-file", () => {
  it("detects text extensions", () => {
    expect(isLikelyTextFile("notes.md")).toBe(true)
    expect(isLikelyTextFile("paper.pdf")).toBe(false)
  })

  it("formats attachment block", () => {
    const block = formatFileAttachmentBlock("a.txt", "hello")
    expect(block).toContain("[附件: a.txt]")
    expect(block).toContain("hello")
  })
})
