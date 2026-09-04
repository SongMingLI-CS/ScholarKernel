import { describe, expect, it } from "vitest"

import { shouldBlockReasoningForNoEvidence } from "@/lib/agent/reasoning-runner"

describe("reasoning evidence guard", () => {
  const failedSearch = {
    id: "research-1",
    ok: false,
    summary: "失败：MissingSearchApiKey",
    output: { error_info: { message: "MissingSearchApiKey" } },
  }

  it("continues when selected library content is available even if web search fails", () => {
    expect(
      shouldBlockReasoningForNoEvidence({
        nodes: [{ id: "research-1", type: "research", provider: "cloud", status: "error" }],
        results: [failedSearch],
        sources: [],
        libraryContext: "【已选文献库上下文】\n《机器学习》第一章正文",
      })
    ).toBe(false)
  })

  it("blocks when every collection path failed and no library content exists", () => {
    expect(
      shouldBlockReasoningForNoEvidence({
        nodes: [{ id: "research-1", type: "research", provider: "cloud", status: "error" }],
        results: [failedSearch],
        sources: [],
      })
    ).toBe(true)
  })
})
