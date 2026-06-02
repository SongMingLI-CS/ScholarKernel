import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { runAgentOnServer } from "@/lib/agent-server-run"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import type { ActiveProviderConfig, ChatHistoryEntry } from "@/lib/agent/planner"
import type { AgentExecutorDeps } from "@/lib/agent/executor-types"

type AgentRunBody = {
  userInput?: string
  provider?: ActiveProviderConfig
  chatHistory?: ChatHistoryEntry[]
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

  const body = await parseJsonBody<AgentRunBody>(req)
  if (!body?.userInput?.trim() || !isValidProvider(body.provider)) {
    return jsonError("Invalid body: userInput and provider required", 400)
  }

  const origin = new URL(req.url)
  const sourceApiBase = `${origin.protocol}//${origin.host}`

  try {
    const result = await runAgentOnServer({
      userInput: body.userInput.trim(),
      activeProvider: body.provider,
      chatHistory: body.chatHistory,
      inference: body.inference,
      localOnly: body.localOnly,
      planRetryMessage: body.planRetryMessage,
      runtimeKeys: body.runtimeKeys,
      sourceApiBase,
      signal: req.signal,
    })
    return jsonOk(result)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Agent run failed"
    console.error("[POST /api/agent/run]", e)
    return jsonError(message, 500)
  }
}
