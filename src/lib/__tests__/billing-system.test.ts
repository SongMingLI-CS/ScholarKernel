import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST as agentRunPost } from "@/app/api/agent/run/route"
import { GET as billingMetricsGet } from "@/app/api/user/billing-metrics/route"
import {
  assertQuotaAvailable,
  getBillingSnapshot,
  jsonQuotaExceeded,
  QuotaExceededError,
} from "@/lib/billing/quota-gate"
import {
  calculateTokenCost,
  DEFAULT_FREE_TOKEN_QUOTA,
  estimateSearchTokenUsage,
} from "@/lib/billing/token-pricing"
import {
  ensureUserBilling,
  extractUsageCounts,
  recordTokenUsage,
} from "@/lib/billing/token-audit"

const billingState = new Map<
  string,
  { tokenUsed: number; tokenQuota: number; totalSpent: number; auditCount: number }
>()

function resetBillingState() {
  billingState.clear()
}

function getState(userId: string) {
  if (!billingState.has(userId)) {
    billingState.set(userId, {
      tokenUsed: 0,
      tokenQuota: DEFAULT_FREE_TOKEN_QUOTA,
      totalSpent: 0,
      auditCount: 0,
    })
  }
  return billingState.get(userId)!
}

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-billing-test"),
}))

vi.mock("@/lib/agent-server-run", () => ({
  runAgentOnServer: vi.fn(async () => ({ final: "ok", nodes: [], sources: [] })),
}))

vi.mock("@/lib/agent-jobs", () => ({
  persistAgentJobError: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userBilling: {
      upsert: vi.fn(async ({ where }: { where: { userId: string }; create?: { userId: string } }) => {
        getState(where.userId)
        const s = getState(where.userId)
        return {
          userId: where.userId,
          tokenUsed: s.tokenUsed,
          tokenQuota: s.tokenQuota,
          totalSpent: s.totalSpent,
          updatedAt: new Date(),
        }
      }),
    },
    tokenAuditLog: {
      create: vi.fn(async ({ data }: { data: { userId: string; inputTokens: number; outputTokens: number; calculatedCost: number } }) => {
        const s = getState(data.userId)
        s.auditCount += 1
        return { id: `audit-${s.auditCount}`, ...data, createdAt: new Date() }
      }),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        userBilling: {
          upsert: vi.fn(async ({ where }: { where: { userId: string } }) => {
            getState(where.userId)
            const s = getState(where.userId)
            return { userId: where.userId, ...s, updatedAt: new Date() }
          }),
          update: vi.fn(
            async ({
              where,
              data,
            }: {
              where: { userId: string }
              data: { tokenUsed?: { increment: number }; totalSpent?: { increment: number } }
            }) => {
              const s = getState(where.userId)
              if (data.tokenUsed?.increment) s.tokenUsed += data.tokenUsed.increment
              if (data.totalSpent?.increment) s.totalSpent += data.totalSpent.increment
              return { userId: where.userId, ...s, updatedAt: new Date() }
            }
          ),
        },
        tokenAuditLog: {
          create: vi.fn(
            async ({
              data,
            }: {
              data: {
                userId: string
                inputTokens: number
                outputTokens: number
                calculatedCost: number
              }
            }) => {
              const s = getState(data.userId)
              s.auditCount += 1
              return { id: `audit-${s.auditCount}`, ...data, createdAt: new Date() }
            }
          ),
        },
      }
      return cb(tx)
    }),
  },
}))

describe("token pricing", () => {
  it("calculates DeepSeek-R1 market rates", () => {
    expect(calculateTokenCost("deepseek-r1", 1_000_000, 500_000)).toBeCloseTo(2, 5)
  })

  it("estimates Tavily search token equivalents", () => {
    expect(estimateSearchTokenUsage("transformer attention", 4000)).toBeGreaterThan(2000)
  })
})

describe("usage extraction", () => {
  it("normalizes AI SDK usage metadata", () => {
    expect(extractUsageCounts({ inputTokens: 120, outputTokens: 80, totalTokens: 200 })).toEqual({
      inputTokens: 120,
      outputTokens: 80,
    })
    expect(extractUsageCounts(null)).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})

describe("quota circuit breaker", () => {
  beforeEach(resetBillingState)

  it("blocks exactly at tokenUsed >= tokenQuota", async () => {
    const s = getState("tenant-a")
    s.tokenUsed = DEFAULT_FREE_TOKEN_QUOTA
    s.tokenQuota = DEFAULT_FREE_TOKEN_QUOTA

    await expect(assertQuotaAvailable("tenant-a")).rejects.toBeInstanceOf(QuotaExceededError)

    s.tokenUsed = DEFAULT_FREE_TOKEN_QUOTA - 1
    await expect(assertQuotaAvailable("tenant-a")).resolves.toBeUndefined()
  })

  it("returns standard 402 JSON envelope", async () => {
    const res = jsonQuotaExceeded()
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body).toEqual({
      error: "Quota Exceeded",
      code: 402,
      message: "您的免费学术配额已耗尽，请升级商业套餐。",
    })
  })

  it("intercepts agent run before LLM dispatch", async () => {
    const s = getState("user-billing-test")
    s.tokenUsed = DEFAULT_FREE_TOKEN_QUOTA

    const res = await agentRunPost(
      new Request("http://localhost/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userInput: "hello",
          provider: { providerId: "openai", model: "gpt-4o-mini" },
        }),
      })
    )

    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.code).toBe(402)
    expect(body.error).toBe("Quota Exceeded")
  })
})

describe("concurrent multi-tenant token accounting", () => {
  beforeEach(resetBillingState)

  it("keeps per-tenant tokenUsed isolated under parallel load", async () => {
    const tenants = ["tenant-x", "tenant-y", "tenant-z"]
    const rounds = 40
    const perCallTokens = 250

    await Promise.all(
      tenants.flatMap((userId) =>
        Array.from({ length: rounds }, (_, i) =>
          recordTokenUsage({
            userId,
            jobId: `job-${i}`,
            modelUsed: "deepseek-r1",
            inputTokens: 100,
            outputTokens: 150,
          })
        )
      )
    )

    for (const userId of tenants) {
      const snapshot = await getBillingSnapshot(userId)
      expect(snapshot.tokenUsed).toBe(rounds * perCallTokens)
      expect(getState(userId).auditCount).toBe(rounds)
    }
  })

  it("uses atomic increment semantics (no under-count vs expected total)", async () => {
    const userId = "tenant-critical"
    const workers = 100
    const inputTokens = 77
    const outputTokens = 23

    await Promise.all(
      Array.from({ length: workers }, (_, i) =>
        recordTokenUsage({
          userId,
          jobId: `critical-${i}`,
          modelUsed: "deepseek-chat",
          inputTokens,
          outputTokens,
        })
      )
    )

    const billing = await ensureUserBilling(userId)
    expect(billing.tokenUsed).toBe(workers * (inputTokens + outputTokens))
    expect(getState(userId).auditCount).toBe(workers)
  })

  it("trips breaker immediately after concurrent consumption crosses quota", async () => {
    const userId = "tenant-edge"
    const s = getState(userId)
    s.tokenQuota = 10_000
    s.tokenUsed = 9_900

    await recordTokenUsage({
      userId,
      jobId: "edge-job",
      modelUsed: "deepseek-r1",
      inputTokens: 80,
      outputTokens: 40,
    })

    const snapshot = await getBillingSnapshot(userId)
    expect(snapshot.tokenUsed).toBe(10_020)
    expect(snapshot.quotaExceeded).toBe(true)
    await expect(assertQuotaAvailable(userId)).rejects.toBeInstanceOf(QuotaExceededError)
  })
})

describe("GET /api/user/billing-metrics", () => {
  beforeEach(resetBillingState)

  it("returns billing snapshot for authenticated user", async () => {
    const res = await billingMetricsGet(new Request("http://localhost/api/user/billing-metrics"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tokenQuota).toBe(DEFAULT_FREE_TOKEN_QUOTA)
    expect(body.tokenUsed).toBe(0)
    expect(Array.isArray(body.recentJobs)).toBe(true)
  })
})
