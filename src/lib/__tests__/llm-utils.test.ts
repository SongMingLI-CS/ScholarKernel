import { describe, expect, it } from "vitest"

import { needsQueryRewrite, normalizeOpenAICompatBaseUrlWithProxy } from "@/lib/agent/llm-utils"

describe("normalizeOpenAICompatBaseUrlWithProxy", () => {
  it("converts the legacy DeepSeek browser proxy path to the upstream URL on the server", () => {
    expect(normalizeOpenAICompatBaseUrlWithProxy("/api/proxy/deepseek", "deepseek_openai_compat"))
      .toBe("https://api.deepseek.com/v1")
  })
})

describe("needsQueryRewrite", () => {
  it("rewrites generic search boilerplate for a contextual literature comparison", () => {
    expect(
      needsQueryRewrite(
        "对比下其他文献的讲解",
        "latest research papers arxiv research papers arxiv"
      )
    ).toBe(true)
  })

  it("keeps a specific English academic query", () => {
    expect(
      needsQueryRewrite(
        "对比下其他文献的讲解",
        "inductive bias no free lunch theorem concept learning"
      )
    ).toBe(false)
  })
})
