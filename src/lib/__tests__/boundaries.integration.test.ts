import { randomUUID } from "node:crypto"
import { describe, expect, it } from "vitest"

// Explicit opt-in, dedicated database, and loopback endpoint are all required.
const enabled = process.env.SCHOLAR_UPGRADE_TEST_DATABASE === "1"
describe.skipIf(!enabled)("owned academic data in isolated Postgres", () => {
  it("reads a document, updates a message, and persists one normal approval", async () => {
    const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid")
    expect(url.hostname).toBe("127.0.0.1")
    expect(url.port).toBe("55446")
    expect(url.pathname).toBe("/scholar_upgrade")
    const { prisma } = await import("@/lib/prisma")
    const { readOwnedDocument } = await import("@/lib/document-service")
    const { saveOwnedMessage } = await import("@/lib/owned-messages")
    const { applyOwnedIntervention } = await import("@/lib/agent/intervention-service")
    const { waitForHumanIntervention } = await import("@/lib/agent/human-intervention-gate")
    const userId = `upgrade-fixture-${randomUUID()}`
    await prisma.user.create({ data: { id: userId } })
    try {
      const conversation = await prisma.conversation.create({ data: { userId, title: "Synthetic academic fixture" } })
      const document = await prisma.document.create({ data: { conversationId: conversation.id, title: "Fixture", content: "A reproducible academic document." } })
      await expect(readOwnedDocument(userId, document.id)).resolves.toMatchObject({ ok: true, text: document.content })
      const messageId = randomUUID()
      await saveOwnedMessage(userId, conversation.id, { id: messageId, role: "assistant", content: "Draft" })
      await saveOwnedMessage(userId, conversation.id, { id: messageId, role: "assistant", content: "Reviewed" })
      expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1)
      expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).content).toBe("Reviewed")
      const jobId = randomUUID()
      const nodeId = "fixture-review"
      await prisma.agentJob.create({ data: { id: jobId, userId, input: "Synthetic review", status: "running", checkpoint: { humanInterventionPending: { sessionId: jobId, nodeId } } } })
      const waiting = waitForHumanIntervention(jobId, nodeId, "Review", undefined, { userId, jobId })
      await expect(applyOwnedIntervention(userId, jobId, nodeId, { action: "approve" })).resolves.toMatchObject({ duplicate: false })
      await expect(waiting).resolves.toEqual({ action: "approve" })
      await expect(applyOwnedIntervention(userId, jobId, nodeId, { action: "approve" })).resolves.toMatchObject({ duplicate: true })
      expect(await prisma.agentIntervention.count({ where: { jobId } })).toBe(1)
    } finally {
      await prisma.user.delete({ where: { id: userId } })
      await prisma.$disconnect()
    }
  })
})
