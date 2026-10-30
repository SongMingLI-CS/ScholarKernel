import type { Prisma } from "../../../generated/prisma/client"

import { prisma } from "@/lib/prisma"

import { calculateTokenCost, DEFAULT_FREE_TOKEN_QUOTA } from "./token-pricing"
import type { RecordTokenUsageInput } from "./token-usage-bridge"

export type { RecordTokenUsageInput } from "./token-usage-bridge"
export { extractUsageCounts } from "./token-usage-bridge"

export async function ensureUserBilling(userId: string) {
  await prisma.userBilling.createMany({
    data: [{ userId, tokenQuota: DEFAULT_FREE_TOKEN_QUOTA, tokenUsed: 0, totalSpent: 0 }],
    skipDuplicates: true,
  })
  const billing = await prisma.userBilling.findUnique({ where: { userId } })
  if (!billing) throw new Error("Could not initialize user billing")
  return billing
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
        agentId: input.agentId ?? null,
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
  await tx.userBilling.createMany({
    data: [{ userId, tokenQuota: DEFAULT_FREE_TOKEN_QUOTA, tokenUsed: 0, totalSpent: 0 }],
    skipDuplicates: true,
  })
}

/** 异步触发审计写入，不阻塞主流程 */
export function recordTokenUsageAsync(input: RecordTokenUsageInput): void {
  void recordTokenUsage(input).catch((err) => {
    console.error("[billing] recordTokenUsage failed:", err)
  })
}

export function createTokenUsageRecorder(userId: string, jobId?: string) {
  const pending: Promise<void>[] = []
  const record = (input: Omit<RecordTokenUsageInput, "userId" | "jobId">) => {
    const write = recordTokenUsage({ userId, jobId, ...input })
    pending.push(write)
    void write.catch(() => {}) // flush propagates failures before Job completion.
  }
  return { record, flush: () => Promise.all(pending).then(() => undefined) }
}
