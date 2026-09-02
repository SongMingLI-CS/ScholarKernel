import { afterEach, describe, expect, it, vi } from "vitest"

import { streamAgentRun } from "@/lib/agent-stream-client"
import { encodeAgentSseEvent } from "@/lib/agent-stream-protocol"

function chunkedResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    {
      status,
      headers: status === 200 ? { "content-type": "text/event-stream" } : { "content-type": "application/json" },
    }
  )
}

describe("streamAgentRun", () => {
  afterEach(() => vi.restoreAllMocks())

  it("parses split SSE chunks and returns the terminal result", async () => {
    const raw = [
      encodeAgentSseEvent({ type: "token", text: "hel", delta: "hel" }),
      encodeAgentSseEvent({ type: "token", text: "hello", delta: "lo" }),
      encodeAgentSseEvent({ type: "done", final: "hello", nodes: [], sources: [], jobId: "job-1" }),
    ].join("")
    vi.spyOn(globalThis, "fetch").mockResolvedValue(chunkedResponse([raw.slice(0, 13), raw.slice(13, 47), raw.slice(47)]))
    const seen: string[] = []

    const result = await streamAgentRun(
      {
        runId: "run-1",
        userInput: "hi",
        provider: { providerId: "openai", model: "gpt-5" },
      },
      { onEvent: (event) => seen.push(event.type) }
    )

    expect(seen).toEqual(["token", "token", "done"])
    expect(result).toEqual({ final: "hello", nodes: [], sources: [], jobId: "job-1" })
  })

  it("never serializes runtime keys from an unsafe caller object", async () => {
    let sentBody = ""
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      sentBody = String(init?.body ?? "")
      return chunkedResponse([
        encodeAgentSseEvent({ type: "done", final: "ok", nodes: [], sources: [], jobId: "job-1" }),
      ])
    })

    await streamAgentRun(
      {
        runId: "run-1",
        userInput: "hi",
        provider: { providerId: "openai", model: "gpt-5" },
        runtimeKeys: { openai: "must-not-leak" },
      } as never,
      { onEvent: () => undefined }
    )

    expect(sentBody).not.toContain("runtimeKeys")
    expect(sentBody).not.toContain("must-not-leak")
  })

  it("throws the streamed error when no done event is received", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      chunkedResponse([
        encodeAgentSseEvent({ type: "error", code: "MissingApiKey", message: "configure key", retryable: false }),
      ])
    )

    await expect(
      streamAgentRun(
        { userInput: "hi", provider: { providerId: "openai", model: "gpt-5" } },
        { onEvent: () => undefined }
      )
    ).rejects.toMatchObject({ name: "AgentStreamError", code: "MissingApiKey", message: "configure key" })
  })
})
