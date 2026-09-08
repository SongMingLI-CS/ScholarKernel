import { resolveUserIdFromRequest } from "@/lib/auth-user"
import {
  cancelAgentJob,
  claimAgentJobRun,
  completeAgentJob,
  createAgentJob,
  failAgentJob,
  getAgentJobForUser,
  updateAgentJobCheckpoint,
  updateAgentJobPeerReviewCheckpoint,
  updateAgentJobWorkflowTopology,
  withAgentJobHeartbeat,
  type AgentJobCheckpoint,
} from "@/lib/agent-jobs"
import { runAgentOnServer } from "@/lib/agent-server-run"
import { classifyAgentRunError, sanitizeAgentErrorText } from "@/lib/agent-job-errors"
import {
  AGENT_STREAM_PROTOCOL_VERSION,
  encodeAgentSseEvent,
  type AgentStreamEvent,
} from "@/lib/agent-stream-protocol"
import { assertQuotaAvailable, jsonQuotaExceeded, QuotaExceededError } from "@/lib/billing/quota-gate"
import { jsonError, parseJsonBody } from "@/lib/api-utils"
import { loadRuntimeKeysForUser } from "@/lib/server-runtime-keys"
import { interceptScholarCanvasInAssistantBubble } from "@/lib/scholar-canvas"
import {
  mergePeerReviewCheckpoint,
  parsePeerReviewCheckpoint,
  peerReviewCheckpointToJobPatch,
} from "@/lib/agent/peer-review-checkpoint"
import type { AgentExecutorDeps } from "@/lib/agent/executor-types"
import type { ActiveProviderConfig, ChatHistoryEntry, WorkflowNode } from "@/lib/agent/planner"
import { registerActiveAgentRun, unregisterActiveAgentRun } from "@/lib/agent/run-control"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type AgentStreamBody = {
  runId?: string
  jobId?: string
  targetNodeId?: string
  userInput?: string
  provider?: ActiveProviderConfig
  chatHistory?: ChatHistoryEntry[]
  inference?: AgentExecutorDeps["inference"]
  localOnly?: boolean
  planRetryMessage?: string
  resumeNodes?: WorkflowNode[]
  documentIds?: string[]
  runtimeKeys?: unknown
}

type PersistedAgentJob = NonNullable<Awaited<ReturnType<typeof getAgentJobForUser>>>

function persistedResult(job: PersistedAgentJob) {
  if (job.status !== "done" || !job.result || typeof job.result !== "object" || Array.isArray(job.result)) return null
  const result = job.result as Record<string, unknown>
  if (typeof result.final !== "string" || !Array.isArray(result.nodes) || !Array.isArray(result.sources)) return null
  return {
    final: result.final,
    nodes: result.nodes as WorkflowNode[],
    sources: result.sources as import("@/lib/tools/search-tool").AcademicSearchHit[],
  }
}

function reconnectJobStream(input: { initial: PersistedAgentJob; userId: string; runId: string }) {
  const encoder = new TextEncoder()
  let transportClosed = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: AgentStreamEvent) => {
        if (!transportClosed) controller.enqueue(encoder.encode(encodeAgentSseEvent(event)))
      }
      void (async () => {
        let job: PersistedAgentJob | null = input.initial
        let lastNodes = ""
        emit({ type: "hello", version: AGENT_STREAM_PROTOCOL_VERSION, runId: input.runId, jobId: input.initial.id })
        while (job && !transportClosed) {
          const checkpoint = job.checkpoint && typeof job.checkpoint === "object" && !Array.isArray(job.checkpoint)
            ? job.checkpoint as AgentJobCheckpoint
            : null
          const nodes = Array.isArray(checkpoint?.nodes) ? checkpoint.nodes as WorkflowNode[] : []
          const serializedNodes = JSON.stringify(nodes)
          if (nodes.length && serializedNodes !== lastNodes) {
            lastNodes = serializedNodes
            emit({ type: "plan", nodes })
          }
          const result = persistedResult(job)
          if (result) {
            if (JSON.stringify(result.nodes) !== lastNodes) emit({ type: "plan", nodes: result.nodes })
            emit({ type: "done", ...result, jobId: job.id })
            break
          }
          if (job.status === "done") {
            emit({ type: "error", code: "PersistedResultInvalid", message: "Persisted Agent result is incomplete", retryable: false })
            break
          }
          if (job.status === "error" || job.status === "cancelled") {
            emit({
              type: "error",
              code: job.status === "cancelled" ? "Aborted" : "PersistedJobError",
              message: job.status === "cancelled" ? "Agent run cancelled" : sanitizeAgentErrorText(job.errorMessage ?? job.error ?? "Agent run failed", 500),
              retryable: job.status === "error",
            })
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 500))
          if (!transportClosed) job = await getAgentJobForUser(input.initial.id, input.userId)
        }
      })().catch((error) => {
        if (!transportClosed) emit({ type: "error", code: "ReconnectFailed", message: sanitizeAgentErrorText(error, 500), retryable: true })
      }).finally(() => {
        if (!transportClosed) controller.close()
      })
    },
    cancel() {
      transportClosed = true
    },
  })
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}

function isValidProvider(value: unknown): value is ActiveProviderConfig {
  if (!value || typeof value !== "object") return false
  const rec = value as Record<string, unknown>
  return typeof rec.providerId === "string" && typeof rec.model === "string"
}

function mergeNodePatch(nodes: WorkflowNode[], nodeId: string, patch: Partial<WorkflowNode>): WorkflowNode[] {
  return nodes.map((node) => (node.id === nodeId ? { ...node, ...patch, id: node.id } : node))
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const body = await parseJsonBody<AgentStreamBody>(req)
  if (!body?.userInput?.trim() || !isValidProvider(body.provider)) {
    return jsonError("Invalid body: userInput and provider required", 400)
  }
  if (body.runtimeKeys !== undefined) {
    return jsonError("Provider credentials must not be sent by the browser", 400)
  }

  try {
    await assertQuotaAvailable(userId)
  } catch (error) {
    if (error instanceof QuotaExceededError) return jsonQuotaExceeded(error.message)
    throw error
  }

  let jobId = body.jobId?.trim()
  let existingJob: PersistedAgentJob | null = null
  let completedJobResult: { final: string; nodes: WorkflowNode[]; sources: import("@/lib/tools/search-tool").AcademicSearchHit[] } | null = null
  let initialCheckpoint: AgentJobCheckpoint = { phase: "running" }
  if (jobId) {
    const owned = await getAgentJobForUser(jobId, userId)
    if (!owned) return jsonError("Job not found", 404)
    existingJob = owned
    completedJobResult = persistedResult(owned)
    if (owned.checkpoint && typeof owned.checkpoint === "object") {
      initialCheckpoint = { ...initialCheckpoint, ...(owned.checkpoint as AgentJobCheckpoint) }
    }
  } else {
    const created = await createAgentJob(userId, {
      userInput: body.userInput.trim(),
      provider: body.provider,
    })
    jobId = created.id
  }

  let resumeNodes = body.resumeNodes
  if (jobId && !resumeNodes?.length && Array.isArray(initialCheckpoint.nodes)) {
    resumeNodes = initialCheckpoint.nodes as WorkflowNode[]
  }

  const stableJobId = jobId
  const runId = body.runId?.trim() || crypto.randomUUID()
  const encoder = new TextEncoder()
  if (completedJobResult) {
    const replay = [
      encodeAgentSseEvent({ type: "hello", version: AGENT_STREAM_PROTOCOL_VERSION, runId, jobId: stableJobId }),
      encodeAgentSseEvent({ type: "plan", nodes: completedJobResult.nodes }),
      encodeAgentSseEvent({ type: "done", ...completedJobResult, jobId: stableJobId }),
    ].join("")
    return new Response(replay, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform" } })
  }
  if (existingJob && !body.targetNodeId?.trim()) {
    return reconnectJobStream({ initial: existingJob, userId, runId })
  }
  const runtimeKeys = await loadRuntimeKeysForUser(userId)
  const origin = new URL(req.url)
  const sourceApiBase = `${origin.protocol}//${origin.host}`
  const claimed = await claimAgentJobRun(stableJobId)
  if (!claimed) {
    const current = await getAgentJobForUser(stableJobId, userId)
    if (current) return reconnectJobStream({ initial: current, userId, runId })
    return jsonError("Job not found", 404)
  }
  const executionSignal = registerActiveAgentRun(stableJobId)
  let transportClosed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let lastTokenText = ""
      let jobCheckpoint = initialCheckpoint
      let workflowNodes = resumeNodes ?? []
      let peerReviewCheckpoint = parsePeerReviewCheckpoint(jobCheckpoint)
      let checkpointWrite: Promise<void> = Promise.resolve()

      const queueCheckpoint = (write: () => Promise<unknown>) => {
        checkpointWrite = checkpointWrite
          .then(async () => {
            await write()
          })
          .catch((error) => console.error("[agent stream checkpoint]", error))
      }

      const emit = (event: AgentStreamEvent) => {
        if (closed || transportClosed) return
        try {
          controller.enqueue(encoder.encode(encodeAgentSseEvent(event)))
        } catch {
          transportClosed = true
        }
      }
      const emitText = (text: string, nodeId?: string, thinkingText?: string) => {
        const delta = text.startsWith(lastTokenText) ? text.slice(lastTokenText.length) : text
        lastTokenText = text
        emit({ type: "token", nodeId, text, delta, thinkingText })
        const canvas = interceptScholarCanvasInAssistantBubble(text)
        if (canvas) {
          emit({
            type: "canvas",
            title: canvas.title,
            content: canvas.content,
            complete: canvas.hasCompleteTag,
          })
        }
      }

      emit({ type: "hello", version: AGENT_STREAM_PROTOCOL_VERSION, runId, jobId: stableJobId })

      void (async () => {
        try {
          const result = await withAgentJobHeartbeat(stableJobId, () => runAgentOnServer(
            {
              userId,
              userInput: body.userInput!.trim(),
              activeProvider: body.provider!,
              jobId: stableJobId,
              targetNodeId: body.targetNodeId?.trim() || undefined,
              resumeNodes,
              interventionSessionId: stableJobId,
              peerReviewCheckpoint,
              onPeerReviewCheckpoint: (patch) => {
                peerReviewCheckpoint = mergePeerReviewCheckpoint(peerReviewCheckpoint, patch)
                jobCheckpoint = { ...jobCheckpoint, ...peerReviewCheckpointToJobPatch(peerReviewCheckpoint) }
                queueCheckpoint(() =>
                  updateAgentJobPeerReviewCheckpoint(stableJobId, jobCheckpoint, patch)
                )
              },
              chatHistory: body.chatHistory,
              inference: body.inference,
              localOnly: body.localOnly,
              planRetryMessage: body.planRetryMessage,
              runtimeKeys,
              sourceApiBase,
              signal: executionSignal,
              documentIds: Array.isArray(body.documentIds)
                ? body.documentIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
                : undefined,
            },
            {
              onWorkflowPlanned: (nodes) => {
                workflowNodes = nodes
                jobCheckpoint = { ...jobCheckpoint, phase: "planning", nodes }
                emit({ type: "plan", nodes })
                queueCheckpoint(() => updateAgentJobCheckpoint(stableJobId, jobCheckpoint))
              },
              onWorkflowTopologyPruned: (nodes) => {
                workflowNodes = nodes
                jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes }
                emit({ type: "plan", nodes })
                queueCheckpoint(() => updateAgentJobWorkflowTopology(stableJobId, nodes, jobCheckpoint))
              },
              onNodePatch: (nodeId, patch) => {
                workflowNodes = mergeNodePatch(workflowNodes, nodeId, patch)
                jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes: workflowNodes }
                emit({ type: "node", nodeId, patch })
                queueCheckpoint(() => updateAgentJobCheckpoint(stableJobId, jobCheckpoint))
                const output = patch.output
                if (output && typeof output === "object") {
                  const rec = output as Record<string, unknown>
                  const text =
                    typeof rec.finalResponse === "string"
                      ? rec.finalResponse
                      : typeof rec.text === "string"
                        ? rec.text
                        : null
                  if (text != null) {
                    emitText(text, nodeId, typeof rec.thinkingText === "string" ? rec.thinkingText : undefined)
                  }
                }
              },
              onNodeLog: (nodeId, line) => emit({ type: "log", nodeId, line }),
              onDirectChatStream: (text) => emitText(text),
              onResearchResultsSynced: ({ nodeId, sources }) => emit({ type: "source", nodeId, sources }),
              onEvidenceStatus: (statuses) =>
                emit({
                  type: "evidence",
                  statuses: statuses.map((status) => ({
                    ...status,
                    ...(status.detail
                      ? { detail: sanitizeAgentErrorText(status.detail, 500) }
                      : {}),
                  })),
                }),
              onUsage: (usage) => emit({ type: "usage", ...usage }),
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
                emit({ type: "intervention", ...event })
                queueCheckpoint(() => updateAgentJobCheckpoint(stableJobId, jobCheckpoint))
              },
              onPlanHttpError: (message) =>
                emit({ type: "error", code: "PlanHttpError", message, retryable: true }),
            }
          ))
          await checkpointWrite
          await completeAgentJob(stableJobId, result)
          if (result.sources.length) emit({ type: "source", sources: result.sources })
          emit({ type: "done", ...result, jobId: stableJobId })
        } catch (error) {
          const failure = classifyAgentRunError(error)
          await checkpointWrite
          if (failure.cancelled) {
            await cancelAgentJob(stableJobId, jobCheckpoint).catch(() => undefined)
          } else {
            await failAgentJob(stableJobId, error, { ...jobCheckpoint, phase: "error" }).catch(() => undefined)
          }
          emit({
            type: "error",
            code: failure.code,
            message: failure.message,
            retryable: failure.retryable,
          })
        } finally {
          unregisterActiveAgentRun(stableJobId)
          closed = true
          if (!transportClosed) controller.close()
        }
      })()
    },
    cancel() {
      // Transport disconnect is not job cancellation. The database-backed run
      // continues; explicit DELETE /api/agent/jobs/:id performs cancellation.
      transportClosed = true
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
