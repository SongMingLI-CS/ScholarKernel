import { describe, expect, it } from "vitest"

import { sanitizeAgentErrorText, serializeAgentJobError } from "../agent-job-errors"

/**
 * 错误消息会写进 `AgentJob.errorMessage` 并显示在面板上。
 * 各家 provider 的报错经常回显请求（含 key），所以脱敏必须覆盖**现实的 key 形状**：
 * 原来的 `/sk-[a-zA-Z0-9]{8,}/` 只认「sk- 后面全是字母数字」，
 * 而现代 key 都带中间的连字符（sk-proj-/sk-ant-），正好卡在 `-` 处匹配失败。
 */
describe("错误脱敏覆盖真实 key 形状", () => {
  const cases: Array<[string, string, string]> = [
    ["OpenAI 项目密钥", "Incorrect API key provided: sk-proj-AbCdEfGhIjKlMnOpQrStUvWx", "sk-proj-AbCd"],
    ["Anthropic 密钥", "invalid x-api-key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWx", "sk-ant-api03"],
    ["Tavily 密钥", "401 Unauthorized (key=tvly-dev-a1b2c3d4e5f6g7h8)", "tvly-dev"],
    ["Google 密钥", "API key not valid: AIzaSyD-a1b2c3d4e5f6g7h8i9j0k", "AIzaSyD"],
    ["Groq 密钥", "bad token gsk_a1b2c3d4e5f6g7h8i9j0k", "gsk_a1b2c3"],
  ]

  for (const [label, message, fragment] of cases) {
    it(`脱敏 ${label}`, () => {
      const out = sanitizeAgentErrorText(message)
      expect(out).toContain("[redacted]")
      expect(out).not.toContain(fragment)
    })
  }

  it("不误伤普通错误文案", () => {
    const msg = "Model returned 429: rate limit exceeded for requests-per-minute"
    expect(sanitizeAgentErrorText(msg)).toBe(msg)
  })

  it("序列化后同样脱敏", () => {
    const out = serializeAgentJobError(new Error("upstream rejected key sk-proj-AbCdEfGhIjKlMnOpQrStUvWx"))
    expect(out.errorMessage).not.toContain("sk-proj-AbCd")
  })
})
