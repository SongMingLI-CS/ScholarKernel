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

/** 归一化单个计数：非数字/非有限值 → null（视为「上游未提供」），其余向下取整且不为负 */
function toTokenCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

/**
 * 提取 input/output 两个计数。
 *
 * AI SDK 的 LanguageModelUsage 三个字段全是 `number | undefined`，部分网关
 * （尤其是 OpenAI 兼容代理）只回 totalTokens 不做拆分。旧实现直接忽略
 * totalTokens，于是 `recordLlmUsageAsync` 在 `input + output <= 0` 处提前返回 ——
 * 这类调用**一次都不会记账**，用户白嫖、成本侧看不见。
 *
 * 拆分策略：两个分项都缺失时整体计入 input（宁可少算 output 单价，也不能漏账）；
 * 只缺一项时用 total 减去已知项补齐。
 */
export function extractUsageCounts(usage: UsageCountsInput | undefined | null): {
  inputTokens: number
  outputTokens: number
} {
  if (!usage) return { inputTokens: 0, outputTokens: 0 }
  const input = toTokenCount(usage.inputTokens)
  const output = toTokenCount(usage.outputTokens)
  const total = toTokenCount(usage.totalTokens)

  if (input !== null && output !== null) return { inputTokens: input, outputTokens: output }
  if (total === null) return { inputTokens: input ?? 0, outputTokens: output ?? 0 }
  if (input === null && output === null) return { inputTokens: total, outputTokens: 0 }
  if (input === null) return { inputTokens: Math.max(0, total - (output as number)), outputTokens: output as number }
  return { inputTokens: input, outputTokens: Math.max(0, total - input) }
}

/**
 * 记账失败不得影响主流程。
 *
 * 调用点在 `streamed.usage.then(...)` 里 —— 这里的同步抛错会变成
 * unhandled rejection；Node 默认策略下足以打挂进程，而此刻用户已经付过 LLM 费用。
 */
function safeRecord(
  record: (input: RecordTokenUsageInput) => void,
  input: RecordTokenUsageInput
): void {
  try {
    record(input)
  } catch (err) {
    console.error("[billing] recordTokenUsage threw synchronously:", err)
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
  safeRecord(ctx.recordTokenUsage, {
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
  safeRecord(ctx.recordTokenUsage, {
    userId: ctx.userId,
    jobId: ctx.jobId,
    modelUsed: provider === "tavily" ? "tavily-search" : "serper-search",
    inputTokens: tokens,
    outputTokens: 0,
  })
}
