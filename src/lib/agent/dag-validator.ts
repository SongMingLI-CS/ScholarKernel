import type { WorkflowNode } from "@/lib/agent/planner"

export class WorkflowDagValidationError extends Error {
  constructor(readonly code: "DuplicateNodeId" | "MissingDependency" | "SelfDependency" | "Cycle" | "UnconvergedGraph", detail: string) {
    super(`${code}:${detail}`)
    this.name = "WorkflowDagValidationError"
  }
}

/** Converts historical array plans into explicit sequential dependencies. */
export function normalizeLegacyWorkflowDag(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node, index) => ({
    ...node,
    dependsOn: node.dependsOn ?? (index === 0 ? [] : [nodes[index - 1]!.id]),
    retryPolicy: node.retryPolicy ?? { maxAttempts: 1, backoffMs: 0 },
    timeoutMs: node.timeoutMs ?? 120_000,
    failurePolicy: node.failurePolicy ?? "continue",
  }))
}

export function validateWorkflowDag(nodes: WorkflowNode[]): void {
  if (!nodes.length) throw new WorkflowDagValidationError("UnconvergedGraph", "empty")
  const ids = new Set<string>()
  for (const node of nodes) {
    if (ids.has(node.id)) throw new WorkflowDagValidationError("DuplicateNodeId", node.id)
    ids.add(node.id)
  }
  for (const node of nodes) {
    for (const dependency of node.dependsOn ?? []) {
      if (dependency === node.id) throw new WorkflowDagValidationError("SelfDependency", node.id)
      if (!ids.has(dependency)) throw new WorkflowDagValidationError("MissingDependency", `${node.id}->${dependency}`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const visit = (id: string) => {
    if (visiting.has(id)) throw new WorkflowDagValidationError("Cycle", id)
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) visit(dependency)
    visiting.delete(id)
    visited.add(id)
  }
  for (const node of nodes) visit(node.id)

  if (nodes.length === 1) return
  const dependents = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const node of nodes) for (const dependency of node.dependsOn ?? []) dependents.get(dependency)?.push(node.id)
  const sinks = nodes.filter((node) => !(dependents.get(node.id)?.length))
  if (sinks.length !== 1) throw new WorkflowDagValidationError("UnconvergedGraph", `sinks=${sinks.map((node) => node.id).join(",")}`)
  const reachesSink = new Set<string>()
  const reverse = (id: string) => {
    if (reachesSink.has(id)) return
    reachesSink.add(id)
    for (const dependency of byId.get(id)?.dependsOn ?? []) reverse(dependency)
  }
  reverse(sinks[0]!.id)
  const orphan = nodes.find((node) => !reachesSink.has(node.id))
  if (orphan) throw new WorkflowDagValidationError("UnconvergedGraph", `orphan=${orphan.id}`)
}
