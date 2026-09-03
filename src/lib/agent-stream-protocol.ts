import type { WorkflowNode } from "@/lib/agent/planner"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"
import type { EvidenceStatus } from "@/lib/evidence-status"

export const AGENT_STREAM_PROTOCOL_VERSION = 1 as const

export type AgentStreamUsage = {
  model: string
  inputTokens: number
  outputTokens: number
  ttftMs?: number | null
}

export type AgentStreamEvent =
  | { type: "hello"; version: typeof AGENT_STREAM_PROTOCOL_VERSION; runId: string; jobId: string }
  | { type: "plan"; nodes: WorkflowNode[] }
  | { type: "node"; nodeId: string; patch: Partial<WorkflowNode> }
  | { type: "log"; nodeId: string; line: string }
  | { type: "token"; nodeId?: string; text: string; delta?: string; thinkingText?: string }
  | { type: "canvas"; title: string; content: string; complete: boolean }
  | { type: "source"; nodeId?: string; sources: AcademicSearchHit[] }
  | { type: "evidence"; statuses: EvidenceStatus[] }
  | ({ type: "usage" } & AgentStreamUsage)
  | { type: "intervention"; sessionId: string; nodeId: string; reason: string }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "done"; final: string; nodes: WorkflowNode[]; sources: AcademicSearchHit[]; jobId: string }

export function encodeAgentSseEvent(event: AgentStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
}

function decodeFrame(frame: string): AgentStreamEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n")
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as { type?: unknown }
    if (!parsed || typeof parsed !== "object" || typeof parsed.type !== "string") return null
    return parsed as AgentStreamEvent
  } catch {
    return null
  }
}

export function createAgentSseParser() {
  let buffer = ""

  const drain = (flush: boolean): AgentStreamEvent[] => {
    const out: AgentStreamEvent[] = []
    const normalized = buffer.replace(/\r\n/g, "\n")
    const frames = normalized.split("\n\n")
    buffer = flush ? "" : (frames.pop() ?? "")
    if (flush && frames.length === 0 && normalized) frames.push(normalized)
    for (const frame of frames) {
      const event = decodeFrame(frame)
      if (event) out.push(event)
    }
    return out
  }

  return {
    push(chunk: string): AgentStreamEvent[] {
      buffer += chunk
      return drain(false)
    },
    finish(): AgentStreamEvent[] {
      return drain(true)
    },
  }
}
