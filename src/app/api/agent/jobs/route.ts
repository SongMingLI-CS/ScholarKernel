import { resolveUserIdFromRequest } from "@/lib/auth-user"
import {
  completeAgentJob,
  cancelAgentJob,
  createAgentJob,
  failAgentJob,
  markAgentJobRunning,
  updateAgentJobCheckpoint,
  updateAgentJobPeerReviewCheckpoint,
  updateAgentJobWorkflowTopology,
  type AgentJobCheckpoint,
} from "@/lib/agent-jobs"
import {
  mergePeerReviewCheckpoint,
  parsePeerReviewCheckpoint,
  peerReviewCheckpointToJobPatch,
} from "@/lib/agent/peer-review-checkpoint"
import { runAgentOnServer } from "@/lib/agent-server-run"
import { classifyAgentRunError } from "@/lib/agent-job-errors"
import { assertQuotaAvailable, jsonQuotaExceeded, QuotaExceededError } from "@/lib/billing/quota-gate"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import type { ActiveProviderConfig } from "@/lib/agent/planner"
import type { AgentExecutorDeps } from "@/lib/agent/executor-types"
import { loadRuntimeKeysForUser } from "@/lib/server-runtime-keys"

type AgentJobBody = {
  userInput?: string
  provider?: ActiveProviderConfig
  chatHistory?: import("@/lib/agent/planner").ChatHistoryEntry[]
  inference?: AgentExecutorDeps["inference"]
  localOnly?: boolean
  planRetryMessage?: string
  runtimeKeys?: unknown
}

function isValidProvider(p: unknown): p is ActiveProviderConfig {
  if (!p || typeof p !== "object") return false
  const rec = p as Record<string, unknown>
  return typeof rec.providerId === "string" && typeof rec.model === "string"
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const body = await parseJsonBody<AgentJobBody>(req)
  if (!body?.userInput?.trim() || !isValidProvider(body.provider)) {
    return jsonError("Invalid body: userInput and provider required", 400)
  }
  if (body.runtimeKeys !== undefined) {
    return jsonError("Provider credentials must not be sent by the browser", 400)
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
  let jobCheckpoint: AgentJobCheckpoint = {
    phase: "running",
    ...(job.checkpoint && typeof job.checkpoint === "object" ? (job.checkpoint as AgentJobCheckpoint) : {}),
  }
  let checkpointWrite: Promise<void> = Promise.resolve()
  const queueCheckpoint = (write: () => Promise<unknown>) => {
    checkpointWrite = checkpointWrite
      .then(async () => {
        await write()
      })
      .catch((error) => console.error("[agent job checkpoint]", error))
  }

  try {
    await markAgentJobRunning(job.id)
    const runtimeKeys = await loadRuntimeKeysForUser(userId)
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
          jobCheckpoint = { ...jobCheckpoint, ...peerReviewCheckpointToJobPatch(peerReviewCheckpoint) }
          queueCheckpoint(() => updateAgentJobPeerReviewCheckpoint(job.id, jobCheckpoint, patch))
        },
        chatHistory: body.chatHistory,
        inference: body.inference,
        localOnly: body.localOnly,
        planRetryMessage: body.planRetryMessage,
        runtimeKeys,
        sourceApiBase,
        signal: req.signal,
      },
      {
        onWorkflowPlanned: (nodes) => {
          jobCheckpoint = { ...jobCheckpoint, phase: "planning", nodes }
          queueCheckpoint(() => updateAgentJobCheckpoint(job.id, jobCheckpoint))
        },
        onNodePatch: (id, patch) => {
          jobCheckpoint = {
            ...jobCheckpoint,
            phase: "running",
            nodes: [{ id, patch }],
          }
          queueCheckpoint(() => updateAgentJobCheckpoint(job.id, jobCheckpoint))
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
          } as AgentJobCheckpoint & { humanInterventionPending?: unknown }
          queueCheckpoint(() => updateAgentJobCheckpoint(job.id, jobCheckpoint))
        },
        onWorkflowTopologyPruned: (nodes) => {
          jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes }
          queueCheckpoint(() => updateAgentJobWorkflowTopology(job.id, nodes, jobCheckpoint))
        },
      }
    )
    await checkpointWrite
    const done = await completeAgentJob(job.id, result)
    return jsonOk(done)
  } catch (e) {
    const failure = classifyAgentRunError(e)
    await checkpointWrite
    if (failure.cancelled) {
      await cancelAgentJob(job.id, jobCheckpoint).catch(() => undefined)
    } else {
      await failAgentJob(job.id, e, { phase: "error" })
    }
    console.error("[POST /api/agent/jobs]", e)
    return jsonOk(
      { error: failure.message, code: failure.code, retryable: failure.retryable, jobId: job.id },
      { status: failure.httpStatus }
    )
  }
}
