import { beforeEach, describe, expect, it, vi } from "vitest"

import { ACADEMIC_TEMPLATES } from "@/config/presets"
import {
  buildTemplateBootstrap,
  buildTemplateWorkflowNodes,
  createOptimisticConversationFromTemplate,
  getTemplateById,
  resolveTemplateSystemPrompt,
  validateTemplateCreateBody,
} from "@/lib/template-hub"
import { createTempConversationId, reduceOptimisticConversationState } from "@/lib/optimistic-ui"

describe("template-hub", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
    })
  })

  it("resolves systemPrompt for neurips-peer-review without type breakage", () => {
    const prompt = resolveTemplateSystemPrompt("neurips-peer-review")
    expect(prompt).toBeTruthy()
    expect(typeof prompt).toBe("string")
    expect(prompt).toContain("NeurIPS")
    expect(getTemplateById("neurips-peer-review")?.initialAgents).toHaveLength(3)
  })

  it("buildTemplateBootstrap returns typed workflow nodes", () => {
    const bootstrap = buildTemplateBootstrap("nsfc-grant-audit")
    expect(bootstrap).not.toBeNull()
    expect(bootstrap?.templateId).toBe("nsfc-grant-audit")
    expect(bootstrap?.systemPrompt).toContain("国自然")
    expect(bootstrap?.initialAgents.every((n) => typeof n.id === "string" && typeof n.type === "string")).toBe(true)
    expect(bootstrap?.initialAgents.some((n) => n.status === "running")).toBe(true)
  })

  it("validates template create body and rejects unknown templateId", () => {
    expect(validateTemplateCreateBody({ templateId: "neurips-peer-review", initialInput: "摘要" })).toEqual({
      templateId: "neurips-peer-review",
      initialInput: "摘要",
    })
    expect(validateTemplateCreateBody({ templateId: "unknown-template" })).toBeNull()
    expect(validateTemplateCreateBody(null)).toBeNull()
  })

  it("optimistic conversation inherits template title when workshop card is clicked", () => {
    const tempId = createTempConversationId()
    const template = ACADEMIC_TEMPLATES[1]
    const optimistic = createOptimisticConversationFromTemplate(tempId, template.id)
    expect(optimistic).not.toBeNull()
    expect(optimistic?.title).toBe(template.title)
    expect(optimistic?.id).toBe(tempId)

    const next = reduceOptimisticConversationState(
      { items: [], currentId: null },
      { type: "create", tempId, optimistic: optimistic! }
    )
    expect(next.currentId).toBe(tempId)
    expect(next.items[0]?.title).toBe("国自然本子致命缺陷挖掘机")
  })

  it("buildTemplateWorkflowNodes maps all three presets", () => {
    for (const template of ACADEMIC_TEMPLATES) {
      const nodes = buildTemplateWorkflowNodes(template)
      expect(nodes.length).toBe(template.initialAgents.length)
      expect(nodes[0]?.logs).toBeDefined()
    }
  })
})
