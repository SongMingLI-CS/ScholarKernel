const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{8,}/gi,
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
  if (out.length > maxLen) return `${out.slice(0, maxLen)}…`
  return out
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
