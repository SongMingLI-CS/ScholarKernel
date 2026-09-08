import type { WorkflowNode } from "@/lib/agent/planner"

export type DagNodeRunContext = {
  attempt: number
  upstreamResults: Record<string, unknown>
  signal: AbortSignal
}

export type DagNodeRunResult = { output: unknown; fallback?: boolean }
export type DagNodeRunner = (node: WorkflowNode, context: DagNodeRunContext) => Promise<DagNodeRunResult>
