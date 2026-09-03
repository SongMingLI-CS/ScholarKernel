import type { AgentStreamEvent, AgentStreamUsage } from "@/lib/agent-stream-protocol"
import type { WorkflowNode } from "@/lib/agent/planner"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import type { EvidenceStatus } from "@/lib/evidence-status"

export type AgentStreamEventTarget = {
  onHello?: (event: Extract<AgentStreamEvent, { type: "hello" }>) => void
  onPlan?: (nodes: WorkflowNode[]) => void
  onNode?: (nodeId: string, patch: Partial<WorkflowNode>) => void
  onLog?: (nodeId: string, line: string) => void
  onToken?: (event: Extract<AgentStreamEvent, { type: "token" }>) => void
  onCanvas?: (canvas: { title: string; content: string; complete: boolean }) => void
  onSources?: (sources: AcademicSearchHit[], nodeId?: string) => void
  onEvidence?: (statuses: EvidenceStatus[]) => void
  onUsage?: (usage: AgentStreamUsage) => void
  onIntervention?: (event: { sessionId: string; nodeId: string; reason: string }) => void
  onError?: (event: Extract<AgentStreamEvent, { type: "error" }>) => void
  onDone?: (event: Extract<AgentStreamEvent, { type: "done" }>) => void
}

export function applyAgentStreamEvent(event: AgentStreamEvent, target: AgentStreamEventTarget): void {
  switch (event.type) {
    case "hello":
      target.onHello?.(event)
      return
    case "plan":
      target.onPlan?.(event.nodes)
      return
    case "node":
      target.onNode?.(event.nodeId, event.patch)
      return
    case "log":
      target.onLog?.(event.nodeId, event.line)
      return
    case "token":
      target.onToken?.(event)
      return
    case "canvas":
      target.onCanvas?.({ title: event.title, content: event.content, complete: event.complete })
      return
    case "source":
      target.onSources?.(event.sources, event.nodeId)
      return
    case "evidence":
      target.onEvidence?.(event.statuses)
      return
    case "usage": {
      const { type: _type, ...usage } = event
      void _type
      target.onUsage?.(usage)
      return
    }
    case "intervention":
      target.onIntervention?.({ sessionId: event.sessionId, nodeId: event.nodeId, reason: event.reason })
      return
    case "error":
      target.onError?.(event)
      return
    case "done":
      target.onDone?.(event)
  }
}
