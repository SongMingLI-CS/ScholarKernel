import { randomUUID } from "node:crypto"
import { expect, it, vi } from "vitest"

vi.mock("ai", async importOriginal => ({
  ...await importOriginal<typeof import("ai")>(),
  streamText: vi.fn(() => ({
    fullStream: (async function* () { yield { type: "text-delta", text: "你好，这是合成回归回答。" } })(),
    usage: Promise.resolve({ inputTokens: 12, outputTokens: 8, totalTokens: 20 }),
  })),
}))

it.skipIf(process.env.SCHOLAR_UPGRADE_TEST_DATABASE !== "1")("runs normal chat through the actual worker/executor with a Mock model and durable usage", async () => {
  expect(new URL(process.env.DATABASE_URL!).pathname).toBe("/scholar_upgrade")
  const { prisma } = await import("@/lib/prisma")
  const { createDurableJob } = await import("@/lib/agent/durable-jobs")
  const { runNextDurableJob } = await import("@/lib/agent/job-worker")
  const userId = `chat-fixture-${randomUUID()}`
  await prisma.user.create({ data: { id: userId } })
  try {
    const job = await createDurableJob(userId, { userInput: "你好", provider: { providerId: "ollama", model: "fixture-mock" } })
    await runNextDurableJob("normal-chat-worker")
    const saved = await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(saved.status).toBe("completed")
    expect(saved.result).toMatchObject({ final: "你好，这是合成回归回答。" })
    const usage = await prisma.tokenAuditLog.findMany({ where: { jobId: job.id } })
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ agentId: "direct-chat", inputTokens: 12, outputTokens: 8 })
  } finally {
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  }
})
