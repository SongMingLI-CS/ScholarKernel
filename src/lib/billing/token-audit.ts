import type { Prisma } from "../../../generated/prisma/client"

import { prisma } from "@/lib/prisma"

import { calculateTokenCost, DEFAULT_FREE_TOKEN_QUOTA } from "./token-pricing"
import type { RecordTokenUsageInput } from "./token-usage-bridge"

export type { RecordTokenUsageInput } from "./token-usage-bridge"
export { extractUsageCounts } from "./token-usage-bridge"

export async function ensureUserBilling(userId: string) {
  return prisma.userBilling.upsert({
    where: { userId },
    create: { userId, tokenQuota: DEFAULT_FREE_TOKEN_QUOTA, tokenUsed: 0, totalSpent: 0 },
    update: {},
  })
}

export async function recordTokenUsage(input: RecordTokenUsageInput): Promise<void> {
  const inputTokens = Math.max(0, Math.floor(input.inputTokens))
  const outputTokens = Math.max(0, Math.floor(input.outputTokens))
  const totalTokens = inputTokens + outputTokens
  if (totalTokens <= 0) return

  const calculatedCost = calculateTokenCost(input.modelUsed, inputTokens, outputTokens)

  await prisma.$transaction(async (tx) => {
    await ensureUserBillingInTx(tx, input.userId)
    await tx.tokenAuditLog.create({
      data: {
        userId: input.userId,
        jobId: input.jobId ?? null,
        modelUsed: input.modelUsed,
        inputTokens,
        outputTokens,
        calculatedCost,
        ttftMs: input.ttftMs ?? null,
      },
    })
    await tx.userBilling.update({
      where: { userId: input.userId },
      data: {
        tokenUsed: { increment: totalTokens },
        totalSpent: { increment: calculatedCost },
      },
    })
  })
}

async function ensureUserBillingInTx(tx: Prisma.TransactionClient, userId: string) {
  await tx.userBilling.upsert({
    where: { userId },
    create: { userId, tokenQuota: DEFAULT_FREE_TOKEN_QUOTA, tokenUsed: 0, totalSpent: 0 },
    update: {},
  })
}

/** 异步触发审计写入，不阻塞主流程 */
export function recordTokenUsageAsync(input: RecordTokenUsageInput): void {
  void recordTokenUsage(input).catch((err) => {
    console.error("[billing] recordTokenUsage failed:", err)
  })
}

export function createTokenUsageRecorder(userId: string, jobId?: string) {
  const record = (input: Omit<RecordTokenUsageInput, "userId" | "jobId">) => {
    recordTokenUsageAsync({ userId, jobId, ...input })
  }
  return { record }
}
