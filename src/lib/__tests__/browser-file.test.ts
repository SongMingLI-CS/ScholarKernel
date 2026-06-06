import { describe, expect, it } from "vitest"

import {
  formatFileAttachmentBlock,
  isLayoutAwareUpload,
  isLikelyTextFile,
} from "@/lib/browser-file"

describe("browser-file", () => {
  it("detects text and layout-aware extensions", () => {
    expect(isLikelyTextFile("notes.md")).toBe(true)
    expect(isLikelyTextFile("paper.pdf")).toBe(true)
    expect(isLayoutAwareUpload("paper.pdf")).toBe(true)
    expect(isLayoutAwareUpload("draft.docx")).toBe(true)
  })

  it("formats attachment block", () => {
    const block = formatFileAttachmentBlock("a.txt", "hello")
    expect(block).toContain("[附件: a.txt]")
    expect(block).toContain("hello")
  })
})
