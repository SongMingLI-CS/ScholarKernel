import type { LanguageModelUsage } from "ai"

import { estimateSearchTokenUsage } from "./token-pricing"

export type RecordTokenUsageInput = {
  userId: string
  jobId?: string
  modelUsed: string
  inputTokens: number
  outputTokens: number
  ttftMs?: number | null
}

/**
 * 只需要两个计数，因此按结构最小化声明参数类型：
 * AI SDK 的 LanguageModelUsage 结构上可直接传入，同时允许测试/其他调用方
 * 只提供 inputTokens / outputTokens 两个字段。
 */
export type UsageCountsInput = {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
}

export function extractUsageCounts(usage: UsageCountsInput | undefined | null): {
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
  ttftMs?: number | null
): void {
  if (!ctx.userId || !ctx.recordTokenUsage) return
  const counts = extractUsageCounts(usage)
  if (counts.inputTokens + counts.outputTokens <= 0) return
  ctx.recordTokenUsage({
    userId: ctx.userId,
    jobId: ctx.jobId,
    modelUsed,
    ...counts,
    ttftMs,
  })
}

export function recordSearchUsageAsync(
  ctx: { userId?: string; jobId?: string; recordTokenUsage?: (input: RecordTokenUsageInput) => void },
  provider: "tavily" | "serper",
  query: string,
  resultChars: number
): void {
  if (!ctx.userId || !ctx.recordTokenUsage) return
  const tokens = estimateSearchTokenUsage(query, resultChars)
  ctx.recordTokenUsage({
    userId: ctx.userId,
    jobId: ctx.jobId,
    modelUsed: provider === "tavily" ? "tavily-search" : "serper-search",
    inputTokens: tokens,
    outputTokens: 0,
  })
}
