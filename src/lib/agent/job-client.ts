import { appPath } from "@/lib/app-path"
import { apiFetch } from "@/lib/api-fetch"
import type { AgentExecutorHooks } from "./executor-types"
import type { DurableJobInput } from "./durable-jobs"
import type { WorkflowNode } from "./planner"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

export const serverJobsEnabled = () => process.env.NEXT_PUBLIC_AGENT_EXECUTION === "server"
export type JobResult = { final: string; nodes: WorkflowNode[]; sources: AcademicSearchHit[]; status: "done" | "partial" | "error" }
export type JobSnapshot = { id: string; status: string; assistantMessageId?: string; checkpoint?: { nodes?: WorkflowNode[]; humanInterventionPending?: { nodeId: string; sessionId: string; reason: string } }; result?: JobResult; eventSequence: number; errorMessage?: string }

/** Observation never creates or retries execution. Native SSE resumes using Last-Event-ID. */
export function observeDurableJob(jobId: string, hooks: AgentExecutorHooks, signal: AbortSignal, after = 0): Promise<JobResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Detached", "AbortError")); return }
    const events = new EventSource(appPath(`/api/agent/jobs/${jobId}/events?after=${after}`))
    const close = () => { events.close(); signal.removeEventListener("abort", abort) }
    const abort = () => { close(); reject(new DOMException("Detached", "AbortError")) }
    signal.addEventListener("abort", abort, { once: true })
    let lastSequence = after
    events.onmessage = event => {
      try {
        const item = JSON.parse(event.data) as { sequence: number; type: string; payload: Record<string, unknown> }
        if (item.sequence <= lastSequence) return
        lastSequence = item.sequence
        const payload = item.payload
        switch (item.type) {
          case "workflow_planned": hooks.onWorkflowPlanned?.(payload.nodes as WorkflowNode[]); break
          case "workflow_updated": hooks.onWorkflowTopologyPruned?.(payload.nodes as WorkflowNode[]); break
          case "node_started": case "node_completed": case "node_failed": case "node_updated": hooks.onNodePatch?.(String(payload.nodeId), payload.patch as Partial<WorkflowNode>); break
          case "direct_chat_started": hooks.onDirectChatStart?.(); break
          case "output_delta":
            if (typeof payload.nodeId === "string") hooks.onProgress?.(payload as Parameters<NonNullable<AgentExecutorHooks["onProgress"]>>[0])
            else if (typeof payload.text === "string") hooks.onDirectChatStream?.(payload.text)
            break
          case "sources_updated": hooks.onResearchResultsSynced?.({ nodeId: "retrieval", sources: payload.sources as AcademicSearchHit[], citationsMarkdown: "" }); break
          case "intervention_required": hooks.onInterventionPending?.({ nodeId: String(payload.nodeId), sessionId: jobId, reason: String(payload.reason), status: "pending_approval" }); break
          case "job_completed": close(); resolve(payload as JobResult); break
          case "job_failed": close(); reject(new Error(typeof payload.error === "string" ? payload.error : "JobFailed")); break
          case "job_cancelled": close(); reject(new DOMException("Job cancelled", "AbortError")); break
        }
      } catch (error) { close(); reject(error) }
    }
    // EventSource reconnects automatically. A visible status check avoids an endless
    // spinner if a completed stream is reached after the final event was consumed.
    events.onerror = () => {
      void apiFetch<JobSnapshot>(`/api/agent/jobs/${jobId}`).then(job => {
        if (job.status === "completed" || job.status === "partial") { close(); resolve(job.result!) }
        else if (job.status === "failed") { close(); reject(new Error(job.errorMessage ?? "JobFailed")) }
        else if (job.status === "cancelled") abort()
      }).catch(error => { close(); reject(error) })
    }
  })
}

export async function runDurableAgent(input: DurableJobInput, hooks: AgentExecutorHooks, signal: AbortSignal, onCreated: (id: string) => void) {
  const job = await apiFetch<JobSnapshot>("/api/agent/jobs", { method: "POST", body: JSON.stringify({ ...input, executionMode: "durable" }) })
  onCreated(job.id)
  if (signal.aborted) { await cancelDurableJob(job.id); throw new DOMException("Cancelled", "AbortError") }
  return observeDurableJob(job.id, hooks, signal)
}

export function cancelDurableJob(id: string) {
  return apiFetch(`/api/agent/jobs/${id}/cancel`, { method: "POST" })
}
