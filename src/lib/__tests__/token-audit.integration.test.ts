import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const enabled = process.env.SCHOLAR_UPGRADE_TEST_DATABASE === "1"

describe.skipIf(!enabled)("token usage persistence in isolated Postgres", () => {
  const userId = `token-audit-fixture-${randomUUID()}`

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid")
    expect(`${url.hostname}:${url.port}${url.pathname}`).toBe("127.0.0.1:55446/scholar_upgrade")
    const { prisma } = await import("@/lib/prisma")
    await prisma.user.create({ data: { id: userId } })
  })

  afterAll(async () => {
    if (!enabled) return
    const { prisma } = await import("@/lib/prisma")
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })

  it("persists one billing increment when a usage event is recorded repeatedly", async () => {
    const { recordTokenUsage } = await import("@/lib/billing/token-audit")
    const { prisma } = await import("@/lib/prisma")
    const idempotencyKey = `job-fixture:${randomUUID()}`
    const usage = {
      userId,
      jobId: "job-fixture",
      agentId: "direct-chat",
      modelUsed: "fixture-model",
      inputTokens: 17,
      outputTokens: 9,
      idempotencyKey,
    }

    await Promise.all([recordTokenUsage(usage), recordTokenUsage(usage)])

    const [auditRows, billing] = await Promise.all([
      prisma.tokenAuditLog.findMany({ where: { idempotencyKey } }),
      prisma.userBilling.findUniqueOrThrow({ where: { userId } }),
    ])
    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]).toMatchObject({ inputTokens: 17, outputTokens: 9, agentId: "direct-chat" })
    expect(billing.tokenUsed).toBe(26)
    expect(billing.totalSpent).toBe(auditRows[0]!.calculatedCost)
  })
})
