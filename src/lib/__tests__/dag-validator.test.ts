import { describe, expect, it } from "vitest"

import { normalizeLegacyWorkflowDag, validateWorkflowDag } from "@/lib/agent/dag-validator"
import type { WorkflowNode } from "@/lib/agent/planner"

const node = (id: string, dependsOn?: string[]): WorkflowNode => ({ id, type: "reasoning", provider: "cloud", status: "pending", dependsOn })

describe("workflow DAG validation", () => {
  it("accepts a convergent DAG", () => {
    expect(() => validateWorkflowDag([node("a", []), node("b", []), node("c", ["a", "b"])] )).not.toThrow()
  })

  it.each([
    ["duplicate IDs", [node("a", []), node("a", [])], "DuplicateNodeId"],
    ["missing dependencies", [node("a", ["missing"])], "MissingDependency"],
    ["self dependencies", [node("a", ["a"])], "SelfDependency"],
    ["cycles", [node("a", ["b"]), node("b", ["a"])], "Cycle"],
    ["unconverged isolated output", [node("a", []), node("b", [])], "UnconvergedGraph"],
  ])("rejects %s", (_label, nodes, code) => {
    expect(() => validateWorkflowDag(nodes as WorkflowNode[])).toThrow(String(code))
  })

  it("converts old array plans into explicit sequential dependencies", () => {
    const normalized = normalizeLegacyWorkflowDag([node("a"), node("b"), node("c")])
    expect(normalized.map((item) => item.dependsOn)).toEqual([[], ["a"], ["b"]])
  })
})
