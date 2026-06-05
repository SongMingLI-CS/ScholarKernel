import { resolveUserIdFromRequest } from "@/lib/auth-user"
import {
  completeAgentJob,
  createAgentJob,
  failAgentJob,
  markAgentJobRunning,
  updateAgentJobCheckpoint,
} from "@/lib/agent-jobs"
import { runAgentOnServer } from "@/lib/agent-server-run"
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

  const job = await createAgentJob(userId, {
    userInput: body.userInput.trim(),
    provider: body.provider,
  })

  const origin = new URL(req.url)
  const sourceApiBase = `${origin.protocol}//${origin.host}`

  try {
    await markAgentJobRunning(job.id)
    const result = await runAgentOnServer(
      {
        userInput: body.userInput.trim(),
        activeProvider: body.provider,
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
          void updateAgentJobCheckpoint(job.id, { phase: "planning", nodes })
        },
        onNodePatch: (id, patch) => {
          void updateAgentJobCheckpoint(job.id, {
            phase: "running",
            nodes: [{ id, patch }],
          })
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
