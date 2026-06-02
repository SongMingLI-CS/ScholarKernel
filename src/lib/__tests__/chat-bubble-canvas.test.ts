import { beforeEach, describe, expect, it } from "vitest"

import { bubbleAfterPlanIntercept } from "@/lib/chat-bubble-utils"
import { parseBubbleContentSegments } from "@/lib/scholar-canvas"
import { useAgentStore } from "@/store/useAgentStore"

describe("bubbleAfterPlanIntercept scholar canvas", () => {
  beforeEach(() => {
    useAgentStore.setState({
      canvas: { activeDocument: null, canvasOpen: false },
      providers: {
        active: { providerId: "ollama", model: "llama3.1", baseUrl: "http://localhost:11434" },
      },
    })
  })

  it("routes scholar-canvas tag to store and returns canvas card placeholder", () => {
    const raw = `<scholar-canvas title="综述">\n## 第一节\n</scholar-canvas>`
    const out = bubbleAfterPlanIntercept(raw, "zh")
    const segments = parseBubbleContentSegments(out)
    const card = segments.find((s) => s.type === "canvas-card")
    expect(card).toBeDefined()
    if (card?.type !== "canvas-card") throw new Error("expected canvas card segment")
    expect(card.card.title).toBe("综述")
    expect(card.card.charCount).toBeGreaterThan(0)
    expect(card.card.streaming).toBe(false)
    const st = useAgentStore.getState()
    expect(st.canvas.canvasOpen).toBe(true)
    expect(st.canvas.activeDocument?.title).toBe("综述")
    expect(st.canvas.activeDocument?.content).toContain("## 第一节")
  })

  it("never returns blank bubble for canvas-only stream", () => {
    const raw = `<scholar-canvas title="长文">\n# 第一章\n内容`
    const out = bubbleAfterPlanIntercept(raw, "zh")
    expect(out.trim().length).toBeGreaterThan(0)
    const segments = parseBubbleContentSegments(out)
    const card = segments.find((s) => s.type === "canvas-card")
    expect(card?.type).toBe("canvas-card")
    if (card?.type === "canvas-card") {
      expect(card.card.title).toBe("长文")
      expect(card.card.streaming).toBe(true)
    }
  })
})
