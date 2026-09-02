import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { getAgentJobForUser, persistAgentJobError } from "@/lib/agent-jobs"
import { runAgentOnServer } from "@/lib/agent-server-run"
import { assertQuotaAvailable, jsonQuotaExceeded, QuotaExceededError } from "@/lib/billing/quota-gate"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import type { ActiveProviderConfig, ChatHistoryEntry, WorkflowNode } from "@/lib/agent/planner"
import type { AgentExecutorDeps } from "@/lib/agent/executor-types"
import type { AgentJobCheckpoint } from "@/lib/agent-jobs"

type AgentRunBody = {
  jobId?: string
  targetNodeId?: string
  userInput?: string
  provider?: ActiveProviderConfig
  chatHistory?: ChatHistoryEntry[]
  inference?: AgentExecutorDeps["inference"]
  localOnly?: boolean
  planRetryMessage?: string
  runtimeKeys?: AgentExecutorDeps["runtimeKeys"]
  resumeNodes?: WorkflowNode[]
  documentIds?: string[]
}

function isValidProvider(p: unknown): p is ActiveProviderConfig {
  if (!p || typeof p !== "object") return false
  const rec = p as Record<string, unknown>
  return typeof rec.providerId === "string" && typeof rec.model === "string"
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const body = await parseJsonBody<AgentRunBody>(req)
  if (!body?.userInput?.trim() || !isValidProvider(body.provider)) {
    return jsonError("Invalid body: userInput and provider required", 400)
  }

  try {
    await assertQuotaAvailable(userId)
  } catch (e) {
    if (e instanceof QuotaExceededError) return jsonQuotaExceeded(e.message)
    throw e
  }

  const origin = new URL(req.url)
  const sourceApiBase = `${origin.protocol}//${origin.host}`

  let resumeNodes = body.resumeNodes
  if (body.targetNodeId?.trim() && body.jobId?.trim()) {
    const job = await getAgentJobForUser(body.jobId.trim(), userId)
    if (!job) return jsonError("Job not found", 404)
    const cp = job.checkpoint as AgentJobCheckpoint | null
    if (!resumeNodes?.length && Array.isArray(cp?.nodes)) {
      resumeNodes = cp.nodes as WorkflowNode[]
    }
  }

  try {
    const result = await runAgentOnServer({
      userId,
      userInput: body.userInput.trim(),
      activeProvider: body.provider,
      jobId: body.jobId,
      targetNodeId: body.targetNodeId?.trim() || undefined,
      resumeNodes,
      chatHistory: body.chatHistory,
      inference: body.inference,
      localOnly: body.localOnly,
      planRetryMessage: body.planRetryMessage,
      runtimeKeys: body.runtimeKeys,
      sourceApiBase,
      signal: req.signal,
      documentIds: Array.isArray(body.documentIds)
        ? body.documentIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : undefined,
    })
    return jsonOk(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Agent run failed"
    void persistAgentJobError(userId, e, {
      jobId: body.jobId,
      userInput: body.userInput?.trim(),
      provider: body.provider,
    })
    console.error("[POST /api/agent/run]", e)
    return jsonError(message, 500)
  }
}
