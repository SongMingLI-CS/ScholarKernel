import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AgentExecutor,
  AgentRunCancelledError,
  WorkflowPlanParseError,
  buildChatHistoryForExecutor,
  extractLlmHistory,
  interceptWorkflowPlanInAssistantBubble,
  isDirectChatInput,
  parsePlan,
} from "@/lib/agent-executor"
import type { WorkflowNode } from "@/lib/agent/planner"

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

describe("AgentExecutor workflow outcomes", () => {
  afterEach(() => vi.restoreAllMocks())
  it("returns updated node failure state and an error run outcome", async () => {
    const node: WorkflowNode = { id: "read-1", type: "read_file", provider: "cloud", status: "pending", input: {} }
    vi.spyOn(AgentExecutor.prototype, "plan").mockResolvedValue([node])
    const executor = new AgentExecutor({ activeProvider: { providerId: "ollama", model: "local" } })

    const result = await executor.run("请读取一个项目文件并总结")

    expect(result.status).toBe("error")
    expect(result.nodes[0]?.status).toBe("error")
  })

  it("marks active and pending nodes cancelled when the run signal is aborted", async () => {
    const controller = new AbortController()
    const node: WorkflowNode = { id: "read-1", type: "read_file", provider: "cloud", status: "pending", input: {} }
    vi.spyOn(AgentExecutor.prototype, "plan").mockResolvedValue([node])
    const patches: Array<{ id: string; status?: string }> = []
    const executor = new AgentExecutor(
      { activeProvider: { providerId: "ollama", model: "local" }, signal: controller.signal },
      { onNodePatch: (id, patch) => {
        patches.push({ id, status: patch.status })
        if (patch.status === "running") controller.abort()
      } }
    )

    await expect(executor.run("请读取一个项目文件并总结")).rejects.toBeInstanceOf(AgentRunCancelledError)
    expect(patches).toContainEqual({ id: "read-1", status: "cancelled" })
  })

  it("resumes from completed nodes without invoking the planner", async () => {
    const plan = vi.spyOn(AgentExecutor.prototype, "plan")
    const executor = new AgentExecutor({
      activeProvider: { providerId: "ollama", model: "local" },
      resumeCheckpoint: {
        nodes: [{ id: "done-1", type: "read_file", provider: "cloud", status: "done", output: { text: "saved" } }],
        partialResults: [{ id: "done-1", ok: true, summary: "saved output", output: { text: "saved" } }],
      },
    })

    const result = await executor.run("继续任务")

    expect(plan).not.toHaveBeenCalled()
    expect(result.status).toBe("done")
    expect(result.nodes[0]?.status).toBe("done")
  })

  it("reports partial when a resumed completed node is followed by a failed node", async () => {
    const executor = new AgentExecutor({
      activeProvider: { providerId: "ollama", model: "local" },
      resumeCheckpoint: {
        nodes: [
          { id: "done-1", type: "read_file", provider: "cloud", status: "done", output: { text: "saved" } },
          { id: "read-2", type: "read_file", provider: "cloud", status: "pending", input: {} },
        ],
        partialResults: [{ id: "done-1", ok: true, summary: "saved output", output: { text: "saved" } }],
      },
    })

    const result = await executor.run("继续刚才的论文分析任务并整理结论")

    expect(result.status).toBe("partial")
    expect(result.nodes.map((node) => node.status)).toEqual(["done", "error"])
  })
})
