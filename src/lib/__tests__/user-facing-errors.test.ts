import { describe, expect, it } from "vitest"

import { formatUserFacingErrorMessage, mapErrorToUserFacing } from "@/lib/user-facing-errors"

describe("user-facing-errors", () => {
  it("maps MissingApiKey", () => {
    const mapped = mapErrorToUserFacing(new Error("MissingApiKey"), "zh")
    expect(mapped.title).toContain("缺少")
    expect(mapped.openPanel).toBe("keys")
  })

  it("maps MissingSearchApiKey", () => {
    expect(mapErrorToUserFacing(new Error("MissingSearchApiKey"), "zh").title).toContain("检索")
  })

  it("maps InvalidApiKey", () => {
    expect(mapErrorToUserFacing(new Error("InvalidApiKey:401:bad"), "en").title).toMatch(/Invalid API key/i)
  })

  it("maps CORS failures", () => {
    expect(mapErrorToUserFacing(new Error("Failed to fetch"), "zh").title).toContain("跨域")
  })

  it("maps Ollama connection refused", () => {
    expect(mapErrorToUserFacing(new Error("connect ECONNREFUSED 11434"), "zh").title).toContain("Ollama")
  })

  it("maps timeout", () => {
    expect(mapErrorToUserFacing(new Error("timeout after 60000ms"), "zh").title).toContain("超时")
  })

  it("maps abort", () => {
    expect(mapErrorToUserFacing(new Error("AbortError"), "zh").title).toContain("停止")
  })

  it("maps plan parse errors", () => {
    expect(mapErrorToUserFacing(new Error("InvalidJSON: tasks"), "en").title).toMatch(/Planning parse failed/i)
  })

  it("maps proxy unauthorized", () => {
    expect(mapErrorToUserFacing(new Error("Unauthorized proxy access"), "zh").title).toContain("Proxy")
  })

  it("formats message with action hint", () => {
    const text = formatUserFacingErrorMessage(new Error("MissingApiKey"), "zh")
    expect(text).toContain("缺少 API 密钥")
    expect(text).toContain("建议：")
  })
})
