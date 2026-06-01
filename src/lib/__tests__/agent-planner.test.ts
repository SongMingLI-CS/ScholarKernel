import { describe, expect, it } from "vitest"

import {
  WorkflowPlanParseError,
  interceptWorkflowPlanInAssistantBubble,
  isDirectChatInput,
  parseAndValidateTaskList,
  parsePlan,
} from "@/lib/agent/planner"

describe("agent/planner", () => {
  it("isDirectChatInput matches greetings", () => {
    expect(isDirectChatInput("你好")).toBe(true)
  })

  it("parsePlan parses task object json", () => {
    const raw = '{"tasks":[{"id":"1","type":"reasoning","provider":"cloud","title":"分析"}]}'
    const parsed = parsePlan(raw)
    expect(parsed).toBeTruthy()
  })

  it("parseAndValidateTaskList returns at least one task", () => {
    const list = parseAndValidateTaskList('{"tasks":[{"id":"1","type":"reasoning","provider":"cloud","title":"x"}]}')
    expect(list.length).toBeGreaterThan(0)
  })

  it("interceptWorkflowPlanInAssistantBubble strips plan json", () => {
    const hit = interceptWorkflowPlanInAssistantBubble(
      '{"tasks":[{"id":"1","type":"reasoning","provider":"cloud","title":"Plan"}]}',
      { providerId: "deepseek_openai_compat", model: "deepseek-chat", baseUrl: "/api/proxy/deepseek" }
    )
    expect(hit?.planned.length).toBeGreaterThan(0)
  })

  it("WorkflowPlanParseError carries cause detail", () => {
    const err = new WorkflowPlanParseError("{}", "bad plan", "missing tasks")
    expect(err.causeDetail).toBe("missing tasks")
  })
})
