import { resolveUserIdFromRequest } from "@/lib/auth-user"
import {
  completeAgentJob,
  createAgentJob,
  failAgentJob,
  getAgentJobForUser,
  markAgentJobRunning,
} from "@/lib/agent-jobs"
import { runAgentOnServer } from "@/lib/agent-server-run"
import {
  AGENT_STREAM_PROTOCOL_VERSION,
  encodeAgentSseEvent,
  type AgentStreamEvent,
} from "@/lib/agent-stream-protocol"
import { assertQuotaAvailable, jsonQuotaExceeded, QuotaExceededError } from "@/lib/billing/quota-gate"
import { jsonError, parseJsonBody } from "@/lib/api-utils"
import { loadRuntimeKeysForUser } from "@/lib/server-runtime-keys"
import { interceptScholarCanvasInAssistantBubble } from "@/lib/scholar-canvas"
import type { AgentExecutorDeps } from "@/lib/agent/executor-types"
import type { ActiveProviderConfig, ChatHistoryEntry, WorkflowNode } from "@/lib/agent/planner"

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

function isValidProvider(value: unknown): value is ActiveProviderConfig {
  if (!value || typeof value !== "object") return false
  const rec = value as Record<string, unknown>
  return typeof rec.providerId === "string" && typeof rec.model === "string"
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes("MissingApiKey")) return "MissingApiKey"
  if (/abort/i.test(message)) return "Aborted"
  return "AgentFailed"
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
  if (jobId) {
    const owned = await getAgentJobForUser(jobId, userId)
    if (!owned) return jsonError("Job not found", 404)
  } else {
    const created = await createAgentJob(userId, {
      userInput: body.userInput.trim(),
      provider: body.provider,
    })
    jobId = created.id
  }

  const stableJobId = jobId
  const runId = body.runId?.trim() || crypto.randomUUID()
  const runtimeKeys = await loadRuntimeKeysForUser(userId)
  const origin = new URL(req.url)
  const sourceApiBase = `${origin.protocol}//${origin.host}`
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let lastTokenText = ""

      const emit = (event: AgentStreamEvent) => {
        if (closed) return
        controller.enqueue(encoder.encode(encodeAgentSseEvent(event)))
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
          await markAgentJobRunning(stableJobId)
          const result = await runAgentOnServer(
            {
              userId,
              userInput: body.userInput!.trim(),
              activeProvider: body.provider!,
              jobId: stableJobId,
              targetNodeId: body.targetNodeId?.trim() || undefined,
              resumeNodes: body.resumeNodes,
              chatHistory: body.chatHistory,
              inference: body.inference,
              localOnly: body.localOnly,
              planRetryMessage: body.planRetryMessage,
              runtimeKeys,
              sourceApiBase,
              signal: req.signal,
              documentIds: Array.isArray(body.documentIds)
                ? body.documentIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
                : undefined,
            },
            {
              onWorkflowPlanned: (nodes) => emit({ type: "plan", nodes }),
              onWorkflowTopologyPruned: (nodes) => emit({ type: "plan", nodes }),
              onNodePatch: (nodeId, patch) => {
                emit({ type: "node", nodeId, patch })
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
              onUsage: (usage) => emit({ type: "usage", ...usage }),
              onInterventionPending: (event) => emit({ type: "intervention", ...event }),
              onPlanHttpError: (message) =>
                emit({ type: "error", code: "PlanHttpError", message, retryable: true }),
            }
          )
          await completeAgentJob(stableJobId, result)
          if (result.sources.length) emit({ type: "source", sources: result.sources })
          emit({ type: "done", ...result, jobId: stableJobId })
        } catch (error) {
          await failAgentJob(stableJobId, error, { phase: "error" }).catch(() => undefined)
          emit({
            type: "error",
            code: errorCode(error),
            message: error instanceof Error ? error.message : "Agent run failed",
            retryable: errorCode(error) !== "Aborted",
          })
        } finally {
          closed = true
          controller.close()
        }
      })()
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
