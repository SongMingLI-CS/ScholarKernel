import { describe, expect, it } from "vitest"

import {
  WorkflowPlanParseError,
  buildChatHistoryForExecutor,
  extractLlmHistory,
  interceptWorkflowPlanInAssistantBubble,
  isDirectChatInput,
  parsePlan,
} from "@/lib/agent-executor"

describe("agent-executor helpers", () => {
  describe("isDirectChatInput", () => {
    it("matches greetings", () => {
      expect(isDirectChatInput("你好")).toBe(true)
      expect(isDirectChatInput("hello")).toBe(true)
    })

    it("rejects long or task-like prompts", () => {
      expect(isDirectChatInput("请检索 Transformer 论文并写综述 " + "x".repeat(120))).toBe(false)
      expect(isDirectChatInput("读取 src/lib/agent-executor.ts")).toBe(false)
    })
  })

  describe("parsePlan", () => {
    it("parses task object json", () => {
      const raw = '{"tasks":[{"id":"1","type":"reasoning","provider":"cloud","title":"分析"}]}'
      const parsed = parsePlan(raw)
      expect(parsed).toBeTruthy()
      if (Array.isArray(parsed)) {
        expect(parsed.length).toBeGreaterThan(0)
      } else {
        const tasks = (parsed as { tasks?: unknown[] }).tasks
        expect(Array.isArray(tasks)).toBe(true)
      }
    })

    it("returns structured output when provided", () => {
      const structured = { tasks: [{ type: "research" }] }
      expect(parsePlan("ignored", structured)).toEqual(structured)
    })
  })

  describe("interceptWorkflowPlanInAssistantBubble", () => {
    it("strips inline plan json from assistant bubble", () => {
      const raw = '{"tasks":[{"id":"1","type":"reasoning","provider":"cloud","title":"Plan"}]}'
      const hit = interceptWorkflowPlanInAssistantBubble(raw, {
        providerId: "deepseek_openai_compat",
        model: "deepseek-chat",
        baseUrl: "/api/proxy/deepseek",
      })
      expect(hit?.planned.length).toBeGreaterThan(0)
      expect(hit?.cleanedText.trim()).toBe("")
    })
  })

  describe("buildChatHistoryForExecutor", () => {
    it("weaves source snippets into assistant history", () => {
      const history = buildChatHistoryForExecutor([
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: "answer",
          sources: [{ source_id: "1", title: "Paper A", url: "https://example.com/a" }],
        },
      ])
      expect(history).toHaveLength(2)
      expect(history[1]?.content).toContain("Paper A")
      expect(history[1]?.content).toContain("检索工具返回的文献摘要")
    })
  })

  describe("extractLlmHistory", () => {
    it("drops trailing duplicate current user input", () => {
      const history = extractLlmHistory(
        [
          { role: "user", content: "old" },
          { role: "assistant", content: "reply" },
          { role: "user", content: "current" },
        ],
        "current"
      )
      expect(history.map((m) => m.content)).toEqual(["old", "reply"])
    })
  })

  describe("WorkflowPlanParseError", () => {
    it("carries cause detail", () => {
      const err = new WorkflowPlanParseError("{}", "bad plan", "missing tasks")
      expect(err.causeDetail).toBe("missing tasks")
      expect(err.name).toBe("WorkflowPlanParseError")
    })
  })
})
