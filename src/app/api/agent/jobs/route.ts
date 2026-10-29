import { resolveUserIdFromRequest } from "@/lib/auth-user"
import {
  completeAgentJob,
  cancelAgentJob,
  createAgentJob,
  failAgentJob,
  markAgentJobRunning,
  updateAgentJobCheckpoint,
  type AgentJobCheckpoint,
} from "@/lib/agent-jobs"
import {
  mergePeerReviewCheckpoint,
  parsePeerReviewCheckpoint,
} from "@/lib/agent/peer-review-checkpoint"
import { runAgentOnServer } from "@/lib/agent-server-run"
import { assertQuotaAvailable, jsonQuotaExceeded, QuotaExceededError } from "@/lib/billing/quota-gate"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import type { ActiveProviderConfig } from "@/lib/agent/planner"
import type { AgentExecutorDeps } from "@/lib/agent/executor-types"

type AgentJobBody = {
  userInput?: string
  provider?: ActiveProviderConfig
  chatHistory?: import("@/lib/agent/planner").ChatHistoryEntry[]
  inference?: AgentExecutorDeps["inference"]
  localOnly?: boolean
  planRetryMessage?: string
  runtimeKeys?: AgentExecutorDeps["runtimeKeys"]
}

function isValidProvider(p: unknown): p is ActiveProviderConfig {
  if (!p || typeof p !== "object") return false
  const rec = p as Record<string, unknown>
  return typeof rec.providerId === "string" && typeof rec.model === "string"
}

function applyNodePatch(nodes: unknown[], id: string, patch: Record<string, unknown>): unknown[] {
  const index = nodes.findIndex((node) => node && typeof node === "object" && (node as Record<string, unknown>)["id"] === id)
  if (index < 0) return nodes
  const previous = nodes[index] as Record<string, unknown>
  const oldMetadata = previous["metadata"] && typeof previous["metadata"] === "object"
    ? previous["metadata"] as Record<string, unknown>
    : {}
  const nextMetadata = patch["metadata"] && typeof patch["metadata"] === "object"
    ? { ...oldMetadata, ...(patch["metadata"] as Record<string, unknown>) }
    : oldMetadata
  const next = [...nodes]
  next[index] = { ...previous, ...patch, metadata: nextMetadata }
  return next
}

function isCancellation(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "AgentRunCancelledError"))
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const body = await parseJsonBody<AgentJobBody>(req)
  if (!body?.userInput?.trim() || !isValidProvider(body.provider)) {
    return jsonError("Invalid body: userInput and provider required", 400)
  }

  try {
    await assertQuotaAvailable(userId)
  } catch (e) {
    if (e instanceof QuotaExceededError) return jsonQuotaExceeded(e.message)
    throw e
  }

  const job = await createAgentJob(userId, {
    userInput: body.userInput.trim(),
    provider: body.provider,
  })

  const origin = new URL(req.url)
  const sourceApiBase = `${origin.protocol}//${origin.host}`
  let jobCheckpoint: AgentJobCheckpoint = { phase: "running" }
  let persistenceError: unknown
  let persistenceQueue = Promise.resolve()
  const enqueueCheckpointWrite = () => {
    const snapshot: AgentJobCheckpoint = {
      ...jobCheckpoint,
      nodes: jobCheckpoint.nodes ? [...jobCheckpoint.nodes] : undefined,
      partialResults: jobCheckpoint.partialResults ? [...jobCheckpoint.partialResults] : undefined,
      sources: jobCheckpoint.sources ? [...jobCheckpoint.sources] : undefined,
    }
    persistenceQueue = persistenceQueue
      .catch((error: unknown) => {
        persistenceError ??= error
      })
      .then(() => updateAgentJobCheckpoint(job.id, snapshot).then(() => undefined))
      .catch((error: unknown) => {
        persistenceError ??= error
      })
    return persistenceQueue
  }

  try {
    await markAgentJobRunning(job.id)
    jobCheckpoint = {
      phase: "running",
      ...(job.checkpoint && typeof job.checkpoint === "object" ? (job.checkpoint as AgentJobCheckpoint) : {}),
    }
    let peerReviewCheckpoint = parsePeerReviewCheckpoint(jobCheckpoint)

    const result = await runAgentOnServer(
      {
        userId,
        userInput: body.userInput.trim(),
        activeProvider: body.provider,
        jobId: job.id,
        interventionSessionId: job.id,
        peerReviewCheckpoint,
        onPeerReviewCheckpoint: (patch) => {
          peerReviewCheckpoint = mergePeerReviewCheckpoint(peerReviewCheckpoint, patch)
          jobCheckpoint = { ...jobCheckpoint, phase: "running", peerReview: peerReviewCheckpoint }
          return enqueueCheckpointWrite()
        },
        chatHistory: body.chatHistory,
        inference: body.inference,
        localOnly: body.localOnly,
        planRetryMessage: body.planRetryMessage,
        runtimeKeys: body.runtimeKeys,
        sourceApiBase,
        signal: req.signal,
      },
      {
        onWorkflowPlanned: (nodes) => {
          jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes }
          void enqueueCheckpointWrite()
        },
        onNodePatch: (id, patch) => {
          const nodes = applyNodePatch(jobCheckpoint.nodes ?? [], id, patch as Record<string, unknown>)
          const metadata = patch.metadata && typeof patch.metadata === "object"
            ? patch.metadata as Record<string, unknown>
            : {}
          const hasTerminalNodeState = patch.status === "done" || patch.status === "error"
          let partialResults = jobCheckpoint.partialResults ?? []
          if (hasTerminalNodeState) {
            const ok = patch.status === "done" && metadata["searchStatus"] !== "failed" && metadata["searchStatus"] !== "empty"
            const output = patch.output
            const summary = output && typeof output === "object" && typeof (output as Record<string, unknown>)["text"] === "string"
              ? String((output as Record<string, unknown>)["text"])
              : `${id} ${ok ? "完成" : "失败"}`
            const saved = { id, ok, summary, output }
            const oldIndex = partialResults.findIndex((item) => item && typeof item === "object" && (item as Record<string, unknown>)["id"] === id)
            partialResults = oldIndex < 0
              ? [...partialResults, saved]
              : partialResults.map((item, index) => index === oldIndex ? saved : item)
          }
          jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes, partialResults }
          if (hasTerminalNodeState || patch.status === "running") void enqueueCheckpointWrite()
        },
        onInterventionPending: (event) => {
          jobCheckpoint = {
            ...jobCheckpoint,
            phase: "running",
            humanInterventionPending: {
              nodeId: event.nodeId,
              reason: event.reason,
              sessionId: event.sessionId,
              at: Date.now(),
            },
          }
          void enqueueCheckpointWrite()
        },
        onWorkflowTopologyPruned: (nodes) => {
          jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes }
          void enqueueCheckpointWrite()
        },
        onResearchResultsSynced: ({ sources }) => {
          jobCheckpoint = { ...jobCheckpoint, sources }
          void enqueueCheckpointWrite()
        },
      }
    )
    await persistenceQueue
    if (persistenceError) throw persistenceError
    jobCheckpoint = {
      ...jobCheckpoint,
      phase: result.status,
      nodes: result.nodes,
      sources: result.sources,
    }
    const done = await completeAgentJob(job.id, result)
    return jsonOk(done, { status: result.status === "error" ? 500 : 200 })
  } catch (e) {
    await persistenceQueue.catch(() => undefined)
    const cancelled = isCancellation(e, req.signal)
    const checkpoint = { ...jobCheckpoint }
    checkpoint.phase = cancelled ? "cancelled" : "error"
    const failed = cancelled
      ? await cancelAgentJob(job.id, checkpoint)
      : await failAgentJob(job.id, e, checkpoint)
    console.error("[POST /api/agent/jobs]", e)
    return jsonOk(failed, { status: cancelled ? 200 : 500 })
  }
}
