import { resolveUserIdFromRequest } from "@/lib/auth-user"
import {
  completeAgentJob,
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

  try {
    await markAgentJobRunning(job.id)
    let jobCheckpoint: AgentJobCheckpoint = {
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
          jobCheckpoint = { ...jobCheckpoint, ...peerReviewCheckpointToJobPatch(peerReviewCheckpoint) }
          void updateAgentJobPeerReviewCheckpoint(job.id, jobCheckpoint, patch)
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
          jobCheckpoint = { ...jobCheckpoint, phase: "planning", nodes }
          void updateAgentJobCheckpoint(job.id, jobCheckpoint)
        },
        onNodePatch: (id, patch) => {
          jobCheckpoint = {
            ...jobCheckpoint,
            phase: "running",
            nodes: [{ id, patch }],
          }
          void updateAgentJobCheckpoint(job.id, jobCheckpoint)
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
          void updateAgentJobCheckpoint(job.id, jobCheckpoint)
        },
        onWorkflowTopologyPruned: (nodes) => {
          jobCheckpoint = { ...jobCheckpoint, phase: "running", nodes }
          void updateAgentJobWorkflowTopology(job.id, nodes, jobCheckpoint)
        },
      }
    )
    const done = await completeAgentJob(job.id, result)
    return jsonOk(done)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Agent job failed"
    const failed = await failAgentJob(job.id, e, { phase: "error" })
    console.error("[POST /api/agent/jobs]", e)
    return jsonOk(failed, { status: 500 })
  }
}
