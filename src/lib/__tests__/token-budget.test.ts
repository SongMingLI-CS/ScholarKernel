import { describe, expect, it, vi } from "vitest"
import { streamText, type LanguageModelUsage } from "ai"

import {
  buildReasoningOutputTokenBudget,
  clampTextByChars,
  consumeStreamTextOutput,
  llmCallSettings,
  trimHistoryToContextLimit,
} from "@/lib/agent/llm-utils"
import { recordLlmUsageAsync } from "@/lib/billing/token-usage-bridge"

function makeStream(parts: Array<Record<string, unknown>>, text = "") {
  const fullStream = (async function* () {
    for (const part of parts) yield part
  })()
  return { fullStream, text: Promise.resolve(text) } as unknown as Awaited<ReturnType<typeof streamText>>
}

describe("model call budgets and stream handling", () => {
  it("applies the configured output budget and caps it at the supported setting", () => {
    expect(buildReasoningOutputTokenBudget(512)).toBe(512)
    expect(buildReasoningOutputTokenBudget(0)).toBe(1)
    expect(buildReasoningOutputTokenBudget(20_000)).toBe(8192)
    expect(buildReasoningOutputTokenBudget(undefined)).toBe(1024)
  })

  it("uses a bounded retry count and a call timeout", () => {
    expect(llmCallSettings()).toEqual({ timeout: 60_000, maxRetries: 1 })
  })

  it("keeps reasoning deltas out of user-visible text", async () => {
    const onAccumulated = vi.fn()
    const output = await consumeStreamTextOutput(
      makeStream([
        { type: "reasoning-delta", text: "internal reasoning" },
        { type: "text-delta", text: "visible answer" },
      ]),
      onAccumulated
    )

    expect(output).toBe("visible answer")
    expect(onAccumulated).toHaveBeenCalledWith("visible answer")
  })

  it("surfaces model stream errors and preserves already streamed partial text", async () => {
    const output = makeStream([
      { type: "text-delta", text: "partial answer" },
      { type: "error", error: new Error("provider unavailable") },
    ])

    await expect(consumeStreamTextOutput(output, () => undefined)).rejects.toMatchObject({
      name: "ModelStreamError",
      message: expect.stringContaining("provider unavailable"),
      partialText: "partial answer",
    })
  })

  it("reports an empty model response as an actionable generation error", async () => {
    await expect(consumeStreamTextOutput(makeStream([]), () => undefined)).rejects.toThrow(
      "模型未返回可显示的文本内容"
    )
  })

  it("records real provider usage under the responsible Agent", () => {
    const recordTokenUsage = vi.fn()
    const usage: LanguageModelUsage = {
      inputTokens: 40,
      outputTokens: 12,
      totalTokens: 52,
      inputTokenDetails: { noCacheTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: 12, reasoningTokens: 0 },
    }

    recordLlmUsageAsync({ userId: "user-1", jobId: "job-1", recordTokenUsage }, "model-x", usage, 18, "planner")

    expect(recordTokenUsage).toHaveBeenCalledWith({
      userId: "user-1",
      jobId: "job-1",
      agentId: "planner",
      modelUsed: "model-x",
      inputTokens: 40,
      outputTokens: 12,
      ttftMs: 18,
    })
  })

  it("keeps history inside the configured character budget", () => {
    const history = trimHistoryToContextLimit(
      [
        { role: "user", content: "q".repeat(250) },
        { role: "assistant", content: "a".repeat(250) },
      ],
      "p".repeat(100),
      1300
    )

    expect(history).toHaveLength(1)
    expect(history[0]?.content).toBe("a".repeat(250))
    expect(history.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(400)
  })

  it("keeps truncation markers inside the configured character budget", () => {
    expect(clampTextByChars("x".repeat(100), 24)).toHaveLength(24)
    expect(clampTextByChars("x".repeat(100), 4)).toBe("xxxx")
  })
})
