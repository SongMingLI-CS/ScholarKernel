import { describe, expect, it } from "vitest"

import { exportMarkdownAsDocx } from "@/lib/export-utils"
import { buildCanvasChatPlaceholder, parseBubbleContentSegments } from "@/lib/scholar-canvas"
import { htmlToMarkdown, markdownToCanvasHtml, markdownToHtml } from "@/lib/markdown-bridge"

describe("buildCanvasChatPlaceholder", () => {
  it("returns titled ready card payload in zh", () => {
    const text = buildCanvasChatPlaceholder("Transformer 综述", "zh", false, 900)
    const segments = parseBubbleContentSegments(text)
    expect(segments[0]).toMatchObject({
      type: "canvas-card",
      card: { title: "Transformer 综述", charCount: 900, streaming: false },
    })
  })

  it("returns streaming card payload in en", () => {
    const text = buildCanvasChatPlaceholder("Survey", "en", true, 12)
    const segments = parseBubbleContentSegments(text)
    expect(segments[0]).toMatchObject({
      type: "canvas-card",
      card: { title: "Survey", charCount: 12, streaming: true },
    })
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

  it("renders inline LaTeX in canvas html via katex", () => {
    const html = markdownToCanvasHtml("复杂度 $O(N \\log N)$ 分析")
    expect(html).toContain('class="katex')
  })
})
