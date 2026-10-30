import { prisma } from "@/lib/prisma"
import { runAgentOnServer, type AgentRunInput } from "@/lib/agent-server-run"
import type { AgentExecutorHooks, SubtaskResult } from "./executor-types"
import type { WorkflowNode } from "./planner"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import { mergePeerReviewCheckpoint, parsePeerReviewCheckpoint } from "./peer-review-checkpoint"
import { claimNextJob, commitWorkerEvent, heartbeatJob, terminalPatch, type StoredRunConfig } from "./durable-jobs"
import { JobSuspended } from "./job-signals"
import { decryptFromStorage } from "@/lib/crypto-server"
import { logDiagnosticError } from "@/lib/diagnostics"

export type JobRunner = (input: AgentRunInput, hooks?: AgentExecutorHooks) => ReturnType<typeof runAgentOnServer>
type Checkpoint = {
  phase: string
  nodes?: WorkflowNode[]
  partialResults?: SubtaskResult[]
  sources?: AcademicSearchHit[]
  peerReview?: ReturnType<typeof parsePeerReviewCheckpoint>
  humanInterventionPending?: { sessionId: string; nodeId: string; reason: string; at: number }
}

export async function runNextDurableJob(workerId: string, runner: JobRunner = runAgentOnServer) {
  const job = await claimNextJob(workerId)
  if (!job || !job.leaseOwner || !job.userId) return false
  const lease = job.leaseOwner
  const controller = new AbortController()
  let checkpoint = (job.checkpoint ?? { phase: "running" }) as Checkpoint
  let writes = Promise.resolve()
  const enqueue = (type: string, payload: unknown) => {
    const snapshot = JSON.parse(JSON.stringify(checkpoint)) as Checkpoint
    writes = writes.then(async () => { await commitWorkerEvent(job.id, lease, type, payload, snapshot) })
    // Attach a handler immediately; flush still propagates the original rejection.
    void writes.catch(() => controller.abort())
    return writes
  }
  let heartbeatBusy = false
  const heartbeat = setInterval(() => {
    if (heartbeatBusy) return
    heartbeatBusy = true
    void heartbeatJob(job.id, lease).then(ok => { if (!ok) controller.abort() }).catch(() => controller.abort()).finally(() => { heartbeatBusy = false })
  }, 250)
  const deadline = setTimeout(() => controller.abort(new Error("JobTimeout: 10 minute execution limit")), 10 * 60_000)
  let lastOutputAt = 0
  const hooks: AgentExecutorHooks = {
    onWorkflowPlanned: nodes => { checkpoint = { ...checkpoint, nodes }; void enqueue("workflow_planned", { nodes }) },
    onWorkflowTopologyPruned: nodes => { checkpoint = { ...checkpoint, nodes }; void enqueue("workflow_updated", { nodes }) },
    onNodePatch: (id, patch) => {
      checkpoint = { ...checkpoint, nodes: checkpoint.nodes?.map(n => n.id === id ? { ...n, ...patch, metadata: { ...n.metadata, ...patch.metadata } } : n) }
      const terminal = patch.status === "done" || patch.status === "error"
      if (terminal) {
        const result = { id, ok: patch.status === "done" && patch.metadata?.searchStatus !== "failed" && patch.metadata?.searchStatus !== "empty", summary: patch.status === "done" ? `完成 ${id}` : patch.error ?? `失败 ${id}`, output: patch.output }
        checkpoint.partialResults = [...(checkpoint.partialResults ?? []).filter(r => r.id !== id), result]
      }
      if (patch.status) void enqueue(patch.status === "running" ? "node_started" : patch.status === "done" ? "node_completed" : patch.status === "error" ? "node_failed" : "node_updated", { nodeId: id, patch })
    },
    onDirectChatStart: () => { void enqueue("direct_chat_started", {}) },
    onDirectChatStream: text => {
      if (Date.now() - lastOutputAt < 150) return
      lastOutputAt = Date.now(); void enqueue("output_delta", { text, accumulated: true })
    },
    onProgress: progress => {
      if (Date.now() - lastOutputAt < 150) return
      lastOutputAt = Date.now(); void enqueue("output_delta", { ...progress, accumulated: true })
    },
    onResearchResultsSynced: ({ sources }) => { checkpoint = { ...checkpoint, sources }; void enqueue("sources_updated", { sources }) },
    onInterventionPending: event => {
      checkpoint = { ...checkpoint, humanInterventionPending: { ...event, at: Date.now() } }
      void enqueue("intervention_pending", event)
    },
  }
  try {
    if (job.workflowVersion !== 1) throw new Error("UnsupportedWorkflowVersion")
    const config = (job.runConfig ?? {}) as StoredRunConfig
    const setting = await prisma.userSetting.findUnique({ where: { userId: job.userId }, select: { runtimeKeys: true } })
    let runtimeKeys: AgentRunInput["runtimeKeys"]
    if (setting?.runtimeKeys) {
      try { runtimeKeys = JSON.parse(decryptFromStorage(setting.runtimeKeys)) as AgentRunInput["runtimeKeys"] }
      catch { throw new Error("StoredRuntimeKeysUnreadable: 请重新保存模型配置") }
    }
    const result = await runner({
      ...config, userId: job.userId, userInput: job.input, activeProvider: job.provider as AgentRunInput["activeProvider"],
      conversationId: job.conversationId ?? undefined,
      jobId: job.id, interventionSessionId: job.id, runtimeKeys, signal: controller.signal, suspendForIntervention: true,
      peerReviewCheckpoint: parsePeerReviewCheckpoint(checkpoint),
      onPeerReviewCheckpoint: async patch => {
        checkpoint = { ...checkpoint, peerReview: mergePeerReviewCheckpoint(checkpoint.peerReview ?? null, patch) }
        await enqueue("checkpoint_saved", { stage: patch.markComplete ?? null })
      },
      resumeCheckpoint: checkpoint.nodes?.length ? { nodes: checkpoint.nodes, partialResults: checkpoint.partialResults, sources: checkpoint.sources } : undefined,
      flushCheckpoint: () => writes,
    }, hooks)
    await writes
    const current = await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })
    if (controller.signal.aborted || current.cancelRequested) throw new DOMException("Cancelled", "AbortError")
    const status = result.status === "done" ? "completed" : result.status === "error" ? "failed" : "partial"
    checkpoint = { ...checkpoint, phase: status, nodes: result.nodes, sources: result.sources, humanInterventionPending: undefined }
    await commitWorkerEvent(job.id, lease, status === "failed" ? "job_failed" : "job_completed", { ...result, ...(status === "failed" ? { error: result.final } : {}) }, checkpoint, { ...terminalPatch(status), ...(status === "failed" ? { errorMessage: result.final } : {}), result: JSON.parse(JSON.stringify(result)) })
  } catch (error) {
    try {
      await writes
      const current = await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })
      if (current.cancelRequested) {
        await commitWorkerEvent(job.id, lease, "job_cancelled", {}, { ...checkpoint, phase: "cancelled", nodes: checkpoint.nodes?.map(node => node.status === "done" ? node : { ...node, status: "cancelled" }) }, terminalPatch("cancelled"))
      } else if (error instanceof JobSuspended) {
        await commitWorkerEvent(job.id, lease, "intervention_required", checkpoint.humanInterventionPending ?? {}, { ...checkpoint, phase: "waiting_for_input" }, { status: "waiting_for_input", leaseOwner: null, leaseExpiresAt: null })
      } else {
        const message = error instanceof Error ? error.message : "JobExecutionFailed"
        await commitWorkerEvent(job.id, lease, "job_failed", { error: message }, { ...checkpoint, phase: "failed" }, { ...terminalPatch("failed"), errorMessage: message })
      }
    } catch (persistError) {
      // Lost lease or unavailable database: leave the last committed checkpoint for recovery.
      logDiagnosticError("[job-worker] persistence deferred to recovery", persistError)
    }
  } finally { clearInterval(heartbeat); clearTimeout(deadline) }
  return true
}
