import { resolveUserIdFromRequest } from "@/lib/auth-user"
import {
  cancelAgentJob,
  claimAgentJobForResume,
  completeAgentJob,
  failAgentJob,
  getAgentJobForUser,
  updateAgentJobCheckpoint,
  type AgentJobCheckpoint,
} from "@/lib/agent-jobs"
import { mergePeerReviewCheckpoint, parsePeerReviewCheckpoint } from "@/lib/agent/peer-review-checkpoint"
import { runAgentOnServer } from "@/lib/agent-server-run"
import { assertQuotaAvailable, jsonQuotaExceeded, QuotaExceededError } from "@/lib/billing/quota-gate"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import type { AgentExecutorDeps, SubtaskResult } from "@/lib/agent/executor-types"
import type { ActiveProviderConfig, WorkflowNode } from "@/lib/agent/planner"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

type ResumeBody = {
  runtimeKeys?: AgentExecutorDeps["runtimeKeys"]
  inference?: AgentExecutorDeps["inference"]
  localOnly?: boolean
}

type RouteCtx = { params: Promise<{ id: string }> }

function isProvider(value: unknown): value is ActiveProviderConfig {
  if (!value || typeof value !== "object") return false
  const provider = value as Record<string, unknown>
  return typeof provider["providerId"] === "string" && typeof provider["model"] === "string"
}

function readWorkflowNodes(value: unknown): WorkflowNode[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is WorkflowNode => {
    if (!item || typeof item !== "object") return false
    const node = item as Record<string, unknown>
    return typeof node["id"] === "string" &&
      (node["type"] === "read_file" || node["type"] === "reasoning" || node["type"] === "audit" || node["type"] === "research" || node["type"] === "peer_review") &&
      (node["provider"] === "local" || node["provider"] === "cloud") &&
      (node["status"] === "pending" || node["status"] === "running" || node["status"] === "done" || node["status"] === "error" || node["status"] === "cancelled" || node["status"] === "pending_approval")
  })
}

function readPartialResults(value: unknown): SubtaskResult[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SubtaskResult => {
    if (!item || typeof item !== "object") return false
    const result = item as Record<string, unknown>
    return typeof result["id"] === "string" && typeof result["ok"] === "boolean" && typeof result["summary"] === "string"
  })
}

function readSources(value: unknown): AcademicSearchHit[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is AcademicSearchHit => {
    if (!item || typeof item !== "object") return false
    const source = item as Record<string, unknown>
    return typeof source["source_id"] === "string" && typeof source["title"] === "string" && typeof source["url"] === "string"
  })
}

function patchNode(nodes: unknown[], id: string, patch: Record<string, unknown>): unknown[] {
  return nodes.map((item) => {
    if (!item || typeof item !== "object" || (item as Record<string, unknown>)["id"] !== id) return item
    const node = item as Record<string, unknown>
    const previousMetadata = node["metadata"] && typeof node["metadata"] === "object" ? node["metadata"] as Record<string, unknown> : {}
    const patchMetadata = patch["metadata"] && typeof patch["metadata"] === "object" ? patch["metadata"] as Record<string, unknown> : {}
    return { ...node, ...patch, metadata: { ...previousMetadata, ...patchMetadata } }
  })
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "AgentRunCancelledError"))
}

export async function POST(req: Request, ctx: RouteCtx) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const { id } = await ctx.params
  const job = await getAgentJobForUser(id, userId)
  if (!job) return jsonError("Not found", 404)
  if (job.status !== "cancelled" && job.status !== "error" && job.status !== "partial") {
    return jsonError("Only cancelled, failed, or partial jobs can be resumed", 409)
  }
  if (!isProvider(job.provider)) return jsonError("Stored provider configuration is invalid", 409)

  const body = (await parseJsonBody<ResumeBody>(req)) ?? {}
  try {
    await assertQuotaAvailable(userId)
  } catch (error) {
    if (error instanceof QuotaExceededError) return jsonQuotaExceeded(error.message)
    throw error
  }

  if (!(await claimAgentJobForResume(job.id, userId))) return jsonError("Job is already running or cannot be resumed", 409)

  const checkpoint = job.checkpoint && typeof job.checkpoint === "object"
    ? job.checkpoint as AgentJobCheckpoint
    : { phase: "running" as const }
  const nodes = readWorkflowNodes(checkpoint.nodes)
  let peerReviewCheckpoint = parsePeerReviewCheckpoint(checkpoint)
  let jobCheckpoint: AgentJobCheckpoint = { ...checkpoint, phase: "running", nodes }
  let persistenceError: unknown
  let persistenceQueue = Promise.resolve()
  const saveCheckpoint = () => {
    const snapshot: AgentJobCheckpoint = { ...jobCheckpoint, nodes: [...(jobCheckpoint.nodes ?? [])] }
    persistenceQueue = persistenceQueue
      .catch((error: unknown) => { persistenceError ??= error })
      .then(() => updateAgentJobCheckpoint(job.id, snapshot).then(() => undefined))
      .catch((error: unknown) => { persistenceError ??= error })
    return persistenceQueue
  }

  try {
    const origin = new URL(req.url)
    const result = await runAgentOnServer(
      {
        userId,
        userInput: job.input,
        activeProvider: job.provider,
        jobId: job.id,
        interventionSessionId: job.id,
        peerReviewCheckpoint,
        onPeerReviewCheckpoint: (patch) => {
          peerReviewCheckpoint = mergePeerReviewCheckpoint(peerReviewCheckpoint, patch)
          jobCheckpoint = { ...jobCheckpoint, phase: "running", peerReview: peerReviewCheckpoint }
          return saveCheckpoint()
        },
        inference: body.inference,
        localOnly: body.localOnly,
        runtimeKeys: body.runtimeKeys,
        sourceApiBase: `${origin.protocol}//${origin.host}`,
        signal: req.signal,
        resumeCheckpoint: nodes.length
          ? {
              nodes,
              partialResults: readPartialResults(checkpoint.partialResults),
              sources: readSources(checkpoint.sources),
            }
          : undefined,
      },
      {
        onWorkflowPlanned: (planned) => {
          jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes: planned }
          void saveCheckpoint()
        },
        onNodePatch: (nodeId, patch) => {
          const metadata = patch.metadata && typeof patch.metadata === "object"
            ? patch.metadata as Record<string, unknown>
            : {}
          const hasTerminalState = patch.status === "done" || patch.status === "error"
          let partialResults = jobCheckpoint.partialResults ?? []
          if (hasTerminalState) {
            const ok = patch.status === "done" && metadata["searchStatus"] !== "failed" && metadata["searchStatus"] !== "empty"
            const output = patch.output
            const summary = output && typeof output === "object" && typeof (output as Record<string, unknown>)["text"] === "string"
              ? String((output as Record<string, unknown>)["text"])
              : `${nodeId} ${ok ? "完成" : "失败"}`
            const result = { id: nodeId, ok, summary, output }
            const oldIndex = partialResults.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>)["id"] === nodeId)
            partialResults = oldIndex < 0
              ? [...partialResults, result]
              : partialResults.map((item, index) => index === oldIndex ? result : item)
          }
          jobCheckpoint = {
            ...jobCheckpoint,
            phase: "running",
            nodes: patchNode(jobCheckpoint.nodes ?? [], nodeId, patch as Record<string, unknown>),
            partialResults,
          }
          if (patch.status === "running" || hasTerminalState) void saveCheckpoint()
        },
        onWorkflowTopologyPruned: (planned) => {
          jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes: planned }
          void saveCheckpoint()
        },
        onResearchResultsSynced: ({ sources }) => {
          jobCheckpoint = { ...jobCheckpoint, sources }
          void saveCheckpoint()
        },
      }
    )
    await persistenceQueue
    if (persistenceError) throw persistenceError
    jobCheckpoint = { ...jobCheckpoint, phase: result.status, nodes: result.nodes, sources: result.sources }
    const completed = await completeAgentJob(job.id, result)
    return jsonOk(completed, { status: result.status === "error" ? 500 : 200 })
  } catch (error) {
    await persistenceQueue.catch(() => undefined)
    const cancelled = isCancellation(error, req.signal)
    jobCheckpoint = { ...jobCheckpoint, phase: cancelled ? "cancelled" : "error" }
    if (cancelled) return jsonOk(await cancelAgentJob(job.id, jobCheckpoint))
    return jsonOk(await failAgentJob(job.id, error, jobCheckpoint), { status: 500 })
  }
}
