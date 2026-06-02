import { describe, expect, it } from "vitest"

import { exportMarkdownAsDocx } from "@/lib/export-utils"
import { buildCanvasChatPlaceholder } from "@/lib/scholar-canvas"
import { htmlToMarkdown, markdownToHtml } from "@/lib/markdown-bridge"

describe("buildCanvasChatPlaceholder", () => {
  it("returns titled ready placeholder in zh", () => {
    const text = buildCanvasChatPlaceholder("Transformer 综述", "zh", false)
    expect(text).toContain("📝")
    expect(text).toContain("《Transformer 综述》")
    expect(text).toContain("请查阅并编辑")
  })

  it("returns streaming placeholder in en", () => {
    const text = buildCanvasChatPlaceholder("Survey", "en", true)
    expect(text).toContain("Drafting")
    expect(text).toContain("Survey")
  })
})

describe("exportMarkdownAsDocx", () => {
  it("produces a non-empty docx blob for headings and bold", async () => {
    const md = "# Title\n\n**Bold** intro\n\n| A | B |\n|---|---|\n| 1 | 2 |"
    const blob = await exportMarkdownAsDocx("Test Doc", md)
    expect(blob.size).toBeGreaterThan(1000)
    expect(blob.type).toContain("wordprocessingml")
  })
})

describe("markdown-bridge", () => {
  it("round-trips basic markdown through html", () => {
    const md = "## Section\n\nHello **world**."
    const html = markdownToHtml(md)
    expect(html).toContain("<h2")
    const back = htmlToMarkdown(html)
    expect(back).toContain("Section")
    expect(back).toContain("**world**")
  })
})
