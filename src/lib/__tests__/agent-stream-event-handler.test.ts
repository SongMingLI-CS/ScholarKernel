import { describe, expect, it, vi } from "vitest"

import { applyAgentStreamEvent, type AgentStreamEventTarget } from "@/lib/agent-stream-event-handler"
import type { AgentStreamEvent } from "@/lib/agent-stream-protocol"

function target(): AgentStreamEventTarget {
  return {
    onHello: vi.fn(),
    onPlan: vi.fn(),
    onNode: vi.fn(),
    onLog: vi.fn(),
    onToken: vi.fn(),
    onCanvas: vi.fn(),
    onSources: vi.fn(),
    onUsage: vi.fn(),
    onIntervention: vi.fn(),
    onError: vi.fn(),
    onDone: vi.fn(),
  }
}

describe("applyAgentStreamEvent", () => {
  it("routes every protocol event to the matching UI state target", () => {
    const t = target()
    const events: AgentStreamEvent[] = [
      { type: "hello", version: 1, runId: "r", jobId: "j" },
      { type: "plan", nodes: [] },
      { type: "node", nodeId: "n", patch: { status: "running" } },
      { type: "log", nodeId: "n", line: "line" },
      { type: "token", text: "answer", delta: "answer" },
      { type: "canvas", title: "Doc", content: "body", complete: true },
      { type: "source", sources: [{ source_id: "1", title: "Paper", url: "https://example.com" }] },
      { type: "usage", model: "model", inputTokens: 2, outputTokens: 3 },
      { type: "intervention", sessionId: "r", nodeId: "n", reason: "review" },
      { type: "error", code: "PlanHttpError", message: "failed", retryable: true },
      { type: "done", final: "answer", nodes: [], sources: [], jobId: "j" },
    ]
    for (const event of events) applyAgentStreamEvent(event, t)

    expect(t.onHello).toHaveBeenCalledOnce()
    expect(t.onPlan).toHaveBeenCalledWith([])
    expect(t.onNode).toHaveBeenCalledWith("n", { status: "running" })
    expect(t.onLog).toHaveBeenCalledWith("n", "line")
    expect(t.onToken).toHaveBeenCalledWith(expect.objectContaining({ text: "answer" }))
    expect(t.onCanvas).toHaveBeenCalledWith({ title: "Doc", content: "body", complete: true })
    expect(t.onSources).toHaveBeenCalledWith(expect.any(Array), undefined)
    expect(t.onUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 2, outputTokens: 3 }))
    expect(t.onIntervention).toHaveBeenCalledWith({ sessionId: "r", nodeId: "n", reason: "review" })
    expect(t.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "PlanHttpError" }))
    expect(t.onDone).toHaveBeenCalledWith(expect.objectContaining({ final: "answer" }))
  })
})
