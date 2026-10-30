import type { LanguageModelUsage } from "ai"

export type RecordTokenUsageInput = {
  userId: string
  jobId?: string
  agentId?: string
  modelUsed: string
  inputTokens: number
  outputTokens: number
  ttftMs?: number | null
  idempotencyKey?: string
}

export function extractUsageCounts(usage: LanguageModelUsage | undefined | null): {
  inputTokens: number
  outputTokens: number
} {
  if (!usage) return { inputTokens: 0, outputTokens: 0 }
  const inputTokens = usage.inputTokens ?? 0
  const outputTokens = usage.outputTokens ?? 0
  return {
    inputTokens: Number.isFinite(inputTokens) ? Math.max(0, Math.floor(inputTokens)) : 0,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, Math.floor(outputTokens)) : 0,
  }
}

export function recordLlmUsageAsync(
  ctx: { userId?: string; jobId?: string; recordTokenUsage?: (input: RecordTokenUsageInput) => void },
  modelUsed: string,
  usage: LanguageModelUsage | undefined | null,
  ttftMs?: number | null,
  agentId?: string,
  usageCallId = globalThis.crypto.randomUUID()
): void {
  if (!ctx.userId || !ctx.recordTokenUsage) return
  const counts = extractUsageCounts(usage)
  if (counts.inputTokens + counts.outputTokens <= 0) return
  ctx.recordTokenUsage({
    userId: ctx.userId,
    jobId: ctx.jobId,
    agentId,
    modelUsed,
    ...counts,
    ttftMs,
    idempotencyKey: ctx.jobId ? `${ctx.jobId}:${usageCallId}` : usageCallId,
  })
}
