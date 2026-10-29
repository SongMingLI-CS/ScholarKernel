import { beforeEach, describe, expect, it, vi } from "vitest"

import { getUserBillingMetrics } from "@/lib/billing/billing-metrics"
import { prisma } from "@/lib/prisma"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tokenAuditLog: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}))

vi.mock("@/lib/billing/quota-gate", () => ({
  getBillingSnapshot: vi.fn(async () => ({
    tokenQuota: 10_000,
    tokenUsed: 120,
    totalSpent: 0.002,
    remaining: 9_880,
    usagePercent: 1.2,
    quotaExceeded: false,
  })),
}))

describe("billing metrics", () => {
  beforeEach(() => vi.clearAllMocks())

  it("aggregates actual token audit rows by Agent id", async () => {
    vi.mocked(prisma.tokenAuditLog.findMany).mockResolvedValue([])
    vi.mocked(prisma.tokenAuditLog.groupBy).mockResolvedValue([
      {
        agentId: "reasoning",
        _sum: { inputTokens: 60, outputTokens: 40, calculatedCost: 0.0015 },
        _count: { _all: 1 },
        _avg: { inputTokens: null, outputTokens: null, calculatedCost: null },
        _max: { inputTokens: null, outputTokens: null, calculatedCost: null },
        _min: { inputTokens: null, outputTokens: null, calculatedCost: null },
      },
      {
        agentId: null,
        _sum: { inputTokens: 20, outputTokens: 0, calculatedCost: 0.0005 },
        _count: { _all: 1 },
        _avg: { inputTokens: null, outputTokens: null, calculatedCost: null },
        _max: { inputTokens: null, outputTokens: null, calculatedCost: null },
        _min: { inputTokens: null, outputTokens: null, calculatedCost: null },
      },
    ] as never)

    const metrics = await getUserBillingMetrics("user-1")

    expect(prisma.tokenAuditLog.groupBy).toHaveBeenCalledWith({
      by: ["agentId"],
      where: { userId: "user-1" },
      _sum: { inputTokens: true, outputTokens: true, calculatedCost: true },
    })
    expect(metrics.agentUsage).toEqual([
      { agentId: "reasoning", inputTokens: 60, outputTokens: 40, costUsd: 0.0015 },
      { agentId: "unknown", inputTokens: 20, outputTokens: 0, costUsd: 0.0005 },
    ])
  })
})
