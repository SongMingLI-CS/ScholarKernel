"use client"

import {
  ApiRateLimitError,
  ApiUnauthorizedError,
  notifySessionExpired,
} from "@/lib/api-fetch"
import {
  createAgentSseParser,
  type AgentStreamEvent,
} from "@/lib/agent-stream-protocol"
import type { AgentExecutorDeps } from "@/lib/agent/executor-types"
import type { ActiveProviderConfig, ChatHistoryEntry, WorkflowNode } from "@/lib/agent/planner"

export type StreamAgentRunInput = {
  runId?: string
  jobId?: string
  targetNodeId?: string
  userInput: string
  provider: ActiveProviderConfig
  chatHistory?: ChatHistoryEntry[]
  inference?: AgentExecutorDeps["inference"]
  localOnly?: boolean
  planRetryMessage?: string
  resumeNodes?: WorkflowNode[]
  documentIds?: string[]
}

export type StreamAgentRunResult = Extract<AgentStreamEvent, { type: "done" }> extends infer T
  ? T extends { type: "done" }
    ? Omit<T, "type">
    : never
  : never

export class AgentStreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = "AgentStreamError"
  }
}

export async function streamAgentRun(
  input: StreamAgentRunInput,
  options: { signal?: AbortSignal; onEvent: (event: AgentStreamEvent) => void }
): Promise<StreamAgentRunResult> {
  // Build an explicit allowlisted payload. Never spread caller data: this is the
  // browser-side guard that prevents legacy runtimeKeys from crossing the wire.
  const payload: StreamAgentRunInput = {
    userInput: input.userInput,
    provider: input.provider,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.jobId ? { jobId: input.jobId } : {}),
    ...(input.targetNodeId ? { targetNodeId: input.targetNodeId } : {}),
    ...(input.chatHistory ? { chatHistory: input.chatHistory } : {}),
    ...(input.inference ? { inference: input.inference } : {}),
    ...(input.localOnly !== undefined ? { localOnly: input.localOnly } : {}),
    ...(input.planRetryMessage ? { planRetryMessage: input.planRetryMessage } : {}),
    ...(input.resumeNodes ? { resumeNodes: input.resumeNodes } : {}),
    ...(input.documentIds ? { documentIds: input.documentIds } : {}),
  }

  const response = await fetch("/api/agent/stream", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
    signal: options.signal,
  })

  if (response.status === 401) {
    notifySessionExpired()
    throw new ApiUnauthorizedError()
  }
  if (response.status === 429) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    throw new ApiRateLimitError(body?.error, body?.message)
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `HTTP ${response.status}`)
  }
  if (!response.body) throw new AgentStreamError("EmptyStream", "Agent stream response has no body", true)

  const parser = createAgentSseParser()
  const decoder = new TextDecoder()
  const reader = response.body.getReader()
  let result: StreamAgentRunResult | undefined
  let terminalError: { code: string; message: string; retryable: boolean } | undefined

  const consume = (events: AgentStreamEvent[]) => {
    for (const event of events) {
      options.onEvent(event)
      if (event.type === "done") {
        result = { final: event.final, nodes: event.nodes, sources: event.sources, jobId: event.jobId }
      }
      if (event.type === "error") {
        terminalError = { code: event.code, message: event.message, retryable: event.retryable }
      }
    }
  }

  while (true) {
    const part = await reader.read()
    if (part.done) break
    consume(parser.push(decoder.decode(part.value, { stream: true })))
  }
  consume(parser.push(decoder.decode()))
  consume(parser.finish())

  if (result) return result
  if (terminalError) {
    throw new AgentStreamError(terminalError.code, terminalError.message, terminalError.retryable)
  }
  throw new AgentStreamError("UnexpectedEnd", "Agent stream ended without a completion event", true)
}
