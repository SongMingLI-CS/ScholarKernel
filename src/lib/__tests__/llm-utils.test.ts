import { describe, expect, it } from "vitest"

import { normalizeOpenAICompatBaseUrlWithProxy } from "@/lib/agent/llm-utils"

describe("normalizeOpenAICompatBaseUrlWithProxy", () => {
  it("converts the legacy DeepSeek browser proxy path to the upstream URL on the server", () => {
    expect(normalizeOpenAICompatBaseUrlWithProxy("/api/proxy/deepseek", "deepseek_openai_compat"))
      .toBe("https://api.deepseek.com/v1")
  })
})
