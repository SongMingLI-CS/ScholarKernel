import { describe, expect, it } from "vitest"

import { runAgentWorkflowDag } from "@/lib/agent/agent-dag-runtime"
import type { AgentExecutor } from "@/lib/agent-executor"
import type { WorkflowNode } from "@/lib/agent/planner"

describe("Agent DAG runtime", () => {
  it("uses explicit dependencies rather than array adjacency", async () => {
    const nodes: WorkflowNode[] = [
      { id: "join", type: "reasoning", provider: "cloud", status: "pending", dependsOn: ["left", "right"] },
      { id: "right", type: "research", provider: "cloud", status: "pending", dependsOn: [] },
      { id: "left", type: "research", provider: "cloud", status: "pending", dependsOn: [] },
    ]
    const starts: string[] = []
    const fakeExecutor = { plan: async () => nodes } as unknown as AgentExecutor
    const result = await runAgentWorkflowDag({
      executor: fakeExecutor,
      userInput: "research and synthesize",
      deps: { activeProvider: { providerId: "openai", model: "test" } },
      nodeRunner: async (node, context) => {
        starts.push(node.id)
        if (node.id === "join") expect(Object.keys(context.upstreamResults).sort()).toEqual(["left", "right"])
        return { output: { text: node.id === "join" ? "final synthesis" : `${node.id} evidence` } }
      },
    })
    expect(starts.slice(0, 2).sort()).toEqual(["left", "right"])
    expect(starts[2]).toBe("join")
    expect(result.final).toBe("final synthesis")
    expect(result.nodes.every((node) => node.status === "done")).toBe(true)
  })
})
