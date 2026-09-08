import type { WorkflowNode } from "@/lib/agent/planner"

export type DagEvent =
  | { type: "node"; nodeId: string; patch: Partial<WorkflowNode> }
  | { type: "log"; nodeId: string; line: string }

export type DagEventPublisher = (event: DagEvent) => void | Promise<void>

export function hookDagEventPublisher(hooks: {
  onNodePatch?: (nodeId: string, patch: Partial<WorkflowNode>) => void
  onNodeLog?: (nodeId: string, line: string) => void
}): DagEventPublisher {
  return (event) => {
    if (event.type === "node") hooks.onNodePatch?.(event.nodeId, event.patch)
    else hooks.onNodeLog?.(event.nodeId, event.line)
  }
}
