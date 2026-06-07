import type { WorkflowNode } from "@/lib/agent/planner"

export type PruneWorkflowInput = {
  nodes: WorkflowNode[]
  breakpointNodeId: string
  instruction: string
}

export type PruneWorkflowResult = {
  nodes: WorkflowNode[]
  insertedNodeId: string
  skippedDebate: boolean
}

function slugFromInstruction(instruction: string): string {
  const trimmed = instruction.trim().slice(0, 48)
  const slug = trimmed.replace(/[^\w\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "")
  return slug || "redirect"
}

/** 思考树剪枝：在断点节点后插入人类定制 reasoning 节点，并标记跳过激辩。 */
export function pruneWorkflowAfterHumanIntervention(input: PruneWorkflowInput): PruneWorkflowResult {
  const { nodes, breakpointNodeId, instruction } = input
  const idx = nodes.findIndex((n) => n.id === breakpointNodeId)
  if (idx < 0) {
    return { nodes, insertedNodeId: "", skippedDebate: false }
  }

  const insertedNodeId = `hitl-${slugFromInstruction(instruction)}-${Date.now()}`
  const skipDebate = /跳过\s*r2|skip\s*r2|跳过.*激辩|skip.*debate|跳过.*反驳/i.test(instruction)

  const customNode: WorkflowNode = {
    id: insertedNodeId,
    type: "reasoning",
    provider: "cloud",
    status: "pending",
    title: "Human-Guided Rewrite Plan",
    logs: [],
    input: { humanInstruction: instruction, parentBreakpoint: breakpointNodeId },
    metadata: {
      humanIntervention: true,
      parentBreakpoint: breakpointNodeId,
      instruction,
      prunedDebate: skipDebate,
    },
  }

  const updated = nodes.map((n) => {
    if (n.id !== breakpointNodeId) return n
    return {
      ...n,
      metadata: {
        ...(n.metadata ?? {}),
        humanInterventionInstruction: instruction,
        pendingApprovalResolved: true,
        skipDebate,
      },
    }
  })

  const pruned = [...updated.slice(0, idx + 1), customNode, ...updated.slice(idx + 1)]
  return { nodes: pruned, insertedNodeId, skippedDebate: skipDebate }
}
