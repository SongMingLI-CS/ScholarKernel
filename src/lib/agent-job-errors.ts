import { truncateUtf16 } from "@/lib/text-truncate"

/**
 * 脱敏必须覆盖**现实的 key 形状**，而不只是「sk- 后面全是字母数字」。
 * 现代 provider 的 key 中间带连字符：`sk-proj-…`（OpenAI）、`sk-ant-api03-…`（Anthropic）、
 * `sk-or-v1-…`（OpenRouter）—— 这些正好卡在 `-` 处让旧正则匹配失败，
 * 而错误消息会连同 key 一起写进 AgentJob.errorMessage 并显示在面板上。
 */
const SECRET_PATTERNS = [
  /sk-(?:proj|ant|or|live|test|svcacct)-[A-Za-z0-9_-]{8,}/gi,
  /sk-[a-zA-Z0-9]{8,}/gi,
  /tvly-(?:dev|prod)?-?[A-Za-z0-9_-]{8,}/gi,
  /AIza[0-9A-Za-z_-]{16,}/g,
  /gsk_[A-Za-z0-9]{16,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /api[_-]?key[=:]\s*["']?[\w-]+/gi,
]

export type SerializedAgentJobError = {
  errorMessage: string
  errorStack: string
}

export function sanitizeAgentErrorText(text: string, maxLen = 4000): string {
  let out = text
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted]")
  }
  return truncateUtf16(out, maxLen, "…")
}

export function stackPreview(stack: string | undefined, lines = 5): string {
  if (!stack?.trim()) return ""
  return sanitizeAgentErrorText(
    stack
      .split("\n")
      .slice(0, lines)
      .join("\n")
      .trim()
  )
}

export function serializeAgentJobError(e: unknown): SerializedAgentJobError {
  if (e instanceof Error) {
    return {
      errorMessage: sanitizeAgentErrorText(e.message || "Unknown error"),
      errorStack: stackPreview(e.stack),
    }
  }
  const message = sanitizeAgentErrorText(String(e))
  return { errorMessage: message, errorStack: "" }
}
