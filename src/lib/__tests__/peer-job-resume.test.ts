import { expect, it, vi } from "vitest"
import { AgentExecutor } from "@/lib/agent-executor"
import { buildPeerReviewWorkflowNodes } from "@/lib/agent/planner"
import { executePeerReviewGroup } from "@/lib/agent/peer-review-runner"
vi.mock("@/lib/agent/peer-review-runner", async original => ({
  ...await original<typeof import("@/lib/agent/peer-review-runner")>(),
  executePeerReviewGroup: vi.fn(async ({ groupNodes, hooks }) => {
    hooks.onNodePatch?.(groupNodes[2].id, { status: "done", output: { text: "Recovered area chair" } })
    return groupNodes.map((node: { id: string }) => ({ id: node.id, ok: true, summary: "recovered", output: { text: "Recovered area chair" } }))
  }),
}))
it("re-enters an unfinished peer group whose first two nodes are already done", async () => {
  const nodes = buildPeerReviewWorkflowNodes()
  nodes[0]!.status = "done"
  nodes[1]!.status = "done"
  const executor = new AgentExecutor({ activeProvider: { providerId: "ollama", model: "fixture" }, resumeCheckpoint: { nodes } })
  const result = await executor.run("请评审这篇合成论文")
  expect(executePeerReviewGroup).toHaveBeenCalledTimes(1)
  expect(result.nodes[2]?.status).toBe("done")
})
