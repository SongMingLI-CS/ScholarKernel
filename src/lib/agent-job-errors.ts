const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{8,}/gi,
  /Bearer\s+[a-zA-Z0-9._-]+/gi,
  /api[_-]?key[=:]\s*["']?[\w-]+/gi,
]

export type SerializedAgentJobError = {
  errorMessage: string
  errorStack: string
}

export type ClassifiedAgentRunError = {
  code: "Aborted" | "MissingApiKey" | "MissingSearchApiKey" | "PlanFailed" | "AgentFailed"
  message: string
  retryable: boolean
  httpStatus: number
  cancelled: boolean
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

export function classifyAgentRunError(error: unknown): ClassifiedAgentRunError {
  const raw = error instanceof Error ? error.message : String(error || "Agent run failed")
  const message = sanitizeAgentErrorText(raw || "Agent run failed")
  if ((error instanceof Error && error.name === "AbortError") || /abort(?:ed)?/i.test(message)) {
    return { code: "Aborted", message: "Agent run cancelled", retryable: false, httpStatus: 499, cancelled: true }
  }
  if (message.includes("MissingSearchApiKey")) {
    return { code: "MissingSearchApiKey", message, retryable: false, httpStatus: 422, cancelled: false }
  }
  if (message.includes("MissingApiKey")) {
    return { code: "MissingApiKey", message, retryable: false, httpStatus: 422, cancelled: false }
  }
  if (/WorkflowPlan|InvalidJSON|ZodError|TaskListSchema/i.test(message)) {
    return { code: "PlanFailed", message, retryable: true, httpStatus: 502, cancelled: false }
  }
  return { code: "AgentFailed", message, retryable: true, httpStatus: 500, cancelled: false }
}
