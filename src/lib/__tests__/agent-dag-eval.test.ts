import { performance } from "node:perf_hooks"
import { describe, expect, it } from "vitest"

import { scheduleWorkflowDag } from "@/lib/agent/dag-scheduler"
import type { WorkflowNode } from "@/lib/agent/planner"

const nodes: WorkflowNode[] = [
  { id: "survey", type: "research", provider: "cloud", status: "pending", dependsOn: [], input: { topic: "survey" } },
  { id: "methods", type: "reasoning", provider: "cloud", status: "pending", dependsOn: [], input: { topic: "methods" } },
  { id: "synthesis", type: "reasoning", provider: "cloud", status: "pending", dependsOn: ["survey", "methods"], input: { topic: "synthesis" } },
]

describe("Agent DAG repeatable baseline", () => {
  it("reports sequential versus dependency-driven execution", async () => {
    const baselineStart = performance.now()
    for (let remaining = nodes.length; remaining > 0; remaining -= 1) {
      await new Promise((resolve) => setTimeout(resolve, 8))
    }
    const baselineLatencyMs = performance.now() - baselineStart

    let active = 0
    let maxConcurrent = 0
    const completed = new Set<string>()
    let dependencyViolations = 0
    const dagStart = performance.now()
    const result = await scheduleWorkflowDag({
      nodes,
      concurrency: 2,
      runner: async (node) => {
        if (!(node.dependsOn ?? []).every((id) => completed.has(id))) dependencyViolations += 1
        active += 1
        maxConcurrent = Math.max(maxConcurrent, active)
        await new Promise((resolve) => setTimeout(resolve, 8))
        active -= 1
        completed.add(node.id)
        return { output: node.id }
      },
    })
    const dagLatencyMs = performance.now() - dagStart
    const metrics = {
      before: { executionModel: "array-sequential", maxConcurrent: 1, latencyMs: Number(baselineLatencyMs.toFixed(3)) },
      after: {
        executionModel: "dependsOn-dag",
        maxConcurrent,
        latencyMs: Number(dagLatencyMs.toFixed(3)),
        dependencyViolations,
        completedNodes: [...result.states.values()].filter((state) => state.status === "done").length,
      },
      paidExecutionCostUsd: 0,
    }
    console.info("AGENT_DAG_EVAL", JSON.stringify(metrics))

    expect(maxConcurrent).toBe(2)
    expect(dependencyViolations).toBe(0)
    expect(metrics.after.completedNodes).toBe(3)
  })
})
