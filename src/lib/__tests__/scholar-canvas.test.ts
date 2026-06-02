import { describe, expect, it } from "vitest"

import {
  buildCanvasChatPlaceholder,
  interceptScholarCanvasInAssistantBubble,
  parseBubbleContentSegments,
  SCHOLAR_CANVAS_OUTPUT_DISCIPLINE,
  stripScholarCanvasBlocks,
} from "@/lib/scholar-canvas"

describe("scholar-canvas", () => {
  it("extracts title and content from complete tag", () => {
    const raw = `前言\n<scholar-canvas title="文献综述">\n## 背景\n内容段落\n</scholar-canvas>\n尾声`
    const hit = interceptScholarCanvasInAssistantBubble(raw)
    expect(hit).not.toBeNull()
    expect(hit!.title).toBe("文献综述")
    expect(hit!.content).toContain("## 背景")
    expect(hit!.hasCompleteTag).toBe(true)
    expect(hit!.cleanedText).toBe("前言\n\n尾声")
  })

  it("supports streaming partial tag without closing marker", () => {
    const raw = `<scholar-canvas title="报告">\n# 第一章\n正在撰写`
    const hit = interceptScholarCanvasInAssistantBubble(raw)
    expect(hit!.title).toBe("报告")
    expect(hit!.content).toBe("# 第一章\n正在撰写")
    expect(hit!.hasCompleteTag).toBe(false)
    expect(hit!.cleanedText).toBe("")
  })

  it("returns null when no scholar-canvas tag", () => {
    expect(interceptScholarCanvasInAssistantBubble("普通回复")).toBeNull()
  })

  it("stripScholarCanvasBlocks removes all canvas regions", () => {
    const raw = `a<scholar-canvas title="x">inner</scholar-canvas>b`
    expect(stripScholarCanvasBlocks(raw)).toBe("ab")
  })

  it("SCHOLAR_CANVAS_OUTPUT_DISCIPLINE mentions scholar-canvas tag", () => {
    expect(SCHOLAR_CANVAS_OUTPUT_DISCIPLINE).toContain("<scholar-canvas")
  })

  it("SCHOLAR_CANVAS_OUTPUT_DISCIPLINE requires doctoral depth", () => {
    expect(SCHOLAR_CANVAS_OUTPUT_DISCIPLINE).toContain("博士级别")
    expect(SCHOLAR_CANVAS_OUTPUT_DISCIPLINE).toContain("算法复杂度")
  })

  it("buildCanvasChatPlaceholder embeds parseable card marker with char count", () => {
    const marker = buildCanvasChatPlaceholder("文献综述", "zh", false, 1280)
    const segments = parseBubbleContentSegments(marker)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: "canvas-card",
      card: { title: "文献综述", charCount: 1280, streaming: false },
    })
  })

  it("parseBubbleContentSegments splits prefix markdown and card", () => {
    const raw = `简短说明\n\n${buildCanvasChatPlaceholder("报告", "zh", true, 42)}`
    const segments = parseBubbleContentSegments(raw)
    expect(segments[0]).toEqual({ type: "markdown", text: "简短说明" })
    expect(segments[1]).toMatchObject({
      type: "canvas-card",
      card: { title: "报告", charCount: 42, streaming: true },
    })
  })
})
