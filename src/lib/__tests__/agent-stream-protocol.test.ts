import { describe, expect, it } from "vitest"

import {
  AGENT_STREAM_PROTOCOL_VERSION,
  createAgentSseParser,
  encodeAgentSseEvent,
  type AgentStreamEvent,
} from "@/lib/agent-stream-protocol"

describe("agent stream protocol", () => {
  it("encodes and incrementally parses versioned SSE events", () => {
    const events: AgentStreamEvent[] = [
      {
        type: "hello",
        version: AGENT_STREAM_PROTOCOL_VERSION,
        runId: "run-1",
        jobId: "job-1",
      },
      {
        type: "token",
        nodeId: "reason-1",
        text: "第一行\n第二行",
        delta: "第二行",
      },
      { type: "usage", model: "deepseek-chat", inputTokens: 10, outputTokens: 4 },
    ]
    const encoded = events.map(encodeAgentSseEvent).join("")
    const parser = createAgentSseParser()

    expect(parser.push(encoded.slice(0, 17))).toEqual([])
    const parsed = [
      ...parser.push(encoded.slice(17, 63)),
      ...parser.push(encoded.slice(63)),
      ...parser.finish(),
    ]
    expect(parsed).toEqual(events)
  })

  it("ignores keepalive comments and rejects malformed event payloads", () => {
    const parser = createAgentSseParser()
    expect(parser.push(": keepalive\n\ndata: not-json\n\n")).toEqual([])
    expect(parser.finish()).toEqual([])
  })

  it("supports every event needed by the browser state model", () => {
    const events: AgentStreamEvent[] = [
      { type: "plan", nodes: [] },
      { type: "node", nodeId: "n1", patch: { status: "running" } },
      { type: "log", nodeId: "n1", line: "started" },
      { type: "token", text: "answer", delta: "answer" },
      { type: "canvas", title: "Report", content: "body", complete: false },
      { type: "source", sources: [{ source_id: "1", title: "Paper", url: "https://example.com" }] },
      { type: "evidence", statuses: [{ id: "search:n1", kind: "search", label: "query", state: "degraded" }] },
      { type: "usage", model: "model", inputTokens: 1, outputTokens: 2 },
      { type: "error", code: "AgentFailed", message: "failed", retryable: false },
      { type: "done", final: "answer", nodes: [], sources: [], jobId: "job-1" },
    ]
    const parser = createAgentSseParser()
    const parsed = parser.push(events.map(encodeAgentSseEvent).join(""))
    expect(parsed.map((event) => event.type)).toEqual(events.map((event) => event.type))
  })
})
