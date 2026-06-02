import { beforeEach, describe, expect, it } from "vitest"

import { bubbleAfterPlanIntercept } from "@/lib/chat-bubble-utils"
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

  it("routes scholar-canvas tag to store and returns placeholder", () => {
    const raw = `<scholar-canvas title="综述">\n## 第一节\n</scholar-canvas>`
    const out = bubbleAfterPlanIntercept(raw, "zh")
    expect(out).toContain("📝")
    expect(out).toContain("《综述》")
    expect(out).toContain("请查阅并编辑")
    const st = useAgentStore.getState()
    expect(st.canvas.canvasOpen).toBe(true)
    expect(st.canvas.activeDocument?.title).toBe("综述")
    expect(st.canvas.activeDocument?.content).toContain("## 第一节")
  })

  it("never returns blank bubble for canvas-only stream", () => {
    const raw = `<scholar-canvas title="长文">\n# 第一章\n内容`
    const out = bubbleAfterPlanIntercept(raw, "zh")
    expect(out.trim().length).toBeGreaterThan(0)
    expect(out).toContain("《长文》")
  })
})
