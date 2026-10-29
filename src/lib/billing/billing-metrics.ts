import { prisma } from "@/lib/prisma"

import { getBillingSnapshot } from "./quota-gate"

export type RecentJobMetric = {
  jobId: string
  ttftMs: number | null
  costUsd: number
  modelUsed: string
  createdAt: string
}

export type BillingMetricsPayload = {
  tokenQuota: number
  tokenUsed: number
  totalSpent: number
  remaining: number
  usagePercent: number
  quotaExceeded: boolean
  recentJobs: RecentJobMetric[]
  agentUsage: Array<{
    agentId: string
    inputTokens: number
    outputTokens: number
    costUsd: number
  }>
}

export async function getUserBillingMetrics(userId: string): Promise<BillingMetricsPayload> {
  const snapshot = await getBillingSnapshot(userId)

  const logs = await prisma.tokenAuditLog.findMany({
    where: { userId, jobId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      jobId: true,
      modelUsed: true,
      calculatedCost: true,
      ttftMs: true,
      createdAt: true,
    },
  })
  const agentGroups = await prisma.tokenAuditLog.groupBy({
    by: ["agentId"],
    where: { userId },
    _sum: { inputTokens: true, outputTokens: true, calculatedCost: true },
  })

  const orderedJobIds: string[] = []
  for (const log of logs) {
    if (!log.jobId || orderedJobIds.includes(log.jobId)) continue
    orderedJobIds.push(log.jobId)
    if (orderedJobIds.length >= 3) break
  }

  const recentJobs: RecentJobMetric[] = orderedJobIds.map((jobId) => {
    const jobLogs = logs.filter((l) => l.jobId === jobId)
    const costUsd = jobLogs.reduce((sum, l) => sum + l.calculatedCost, 0)
    const ttftCandidates = jobLogs.map((l) => l.ttftMs).filter((v): v is number => v != null)
    const ttftMs = ttftCandidates.length > 0 ? Math.min(...ttftCandidates) : null
    const latest = jobLogs[0]
    return {
      jobId,
      ttftMs,
      costUsd: Math.round(costUsd * 1e6) / 1e6,
      modelUsed: latest?.modelUsed ?? "unknown",
      createdAt: latest?.createdAt.toISOString() ?? new Date().toISOString(),
    }
  })

  return {
    ...snapshot,
    recentJobs,
    agentUsage: agentGroups
      .map((group) => ({
        agentId: group.agentId ?? "unknown",
        inputTokens: group._sum.inputTokens ?? 0,
        outputTokens: group._sum.outputTokens ?? 0,
        costUsd: Math.round((group._sum.calculatedCost ?? 0) * 1e6) / 1e6,
      }))
      .sort((a, b) => b.costUsd - a.costUsd),
  }
}
