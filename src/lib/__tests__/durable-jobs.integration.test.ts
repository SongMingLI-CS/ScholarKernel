import { execFile } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ userId: "" }))
vi.mock("@/lib/auth-user", () => ({ resolveUserIdFromRequest: async () => session.userId }))
const enabled = process.env.SCHOLAR_UPGRADE_TEST_DATABASE === "1"
describe.skipIf(!enabled)("durable Job normal lifecycle in isolated Postgres", () => {
  let userId: string
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid")
    expect(`${url.hostname}:${url.port}${url.pathname}`).toBe("127.0.0.1:55446/scholar_upgrade")
    const { prisma } = await import("@/lib/prisma")
    userId = `durable-fixture-${randomUUID()}`
    session.userId = userId
    await prisma.user.create({ data: { id: userId } })
  })
  afterAll(async () => {
    if (!userId) return
    const { prisma } = await import("@/lib/prisma")
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  })
  const input = () => ({ userInput: "Synthetic academic task", provider: { providerId: "ollama" as const, model: "fixture" } })

  it("persists final output and replays ordered events without executing again", async () => {
    const { createDurableJob, readJobEvents } = await import("@/lib/agent/durable-jobs")
    const { runNextDurableJob } = await import("@/lib/agent/job-worker")
    const { prisma } = await import("@/lib/prisma")
    const job = await createDurableJob(userId, input())
    let calls = 0
    await runNextDurableJob("worker-a", async (_input, hooks) => {
      calls++
      hooks?.onDirectChatStream?.("Fixture answer")
      return { final: "Fixture answer", nodes: [], sources: [], status: "done" }
    })
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("completed")
    const events = await readJobEvents(userId, job.id, 0)
    expect(events.map(e => e.type)).toContain("output_delta")
    expect(events.map(e => e.type)).toContain("job_completed")
    expect(events.map(e => e.sequence)).toEqual(events.map((_, i) => i + 1))
    expect(await readJobEvents(userId, job.id, events.at(-1)!.sequence)).toEqual([])
    await runNextDurableJob("worker-b", async () => { throw new Error("Unexpected re-execution") })
    expect(calls).toBe(1)
  })

  it("recovers an expired lease with committed completed nodes intact", async () => {
    const { createDurableJob, claimNextJob, commitWorkerEvent } = await import("@/lib/agent/durable-jobs")
    const { runNextDurableJob } = await import("@/lib/agent/job-worker")
    const { prisma } = await import("@/lib/prisma")
    const job = await createDurableJob(userId, input())
    const claim = await claimNextJob("crashed-worker")
    expect(claim?.id).toBe(job.id)
    await commitWorkerEvent(job.id, claim!.leaseOwner!, "node_completed", { nodeId: "read-1" }, { phase: "running", nodes: [{ id: "read-1", type: "read_file", provider: "local", status: "done", input: { documentId: "fixture" } }], partialResults: [{ id: "read-1", ok: true, summary: "saved", output: { text: "saved" } }] })
    await prisma.agentJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } })
    await runNextDurableJob("replacement-worker", async (run) => {
      expect(run.resumeCheckpoint?.nodes[0]?.status).toBe("done")
      expect(run.resumeCheckpoint?.partialResults?.[0]?.summary).toBe("saved")
      return { final: "Recovered", nodes: run.resumeCheckpoint!.nodes, sources: [], status: "done" }
    })
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).attempt).toBe(2)
    await expect(commitWorkerEvent(job.id, claim!.leaseOwner!, "node_completed", {}, { phase: "running" })).rejects.toThrow("JobLeaseLost")
  })

  it("propagates cancellation to an active runner and persists cancelled", async () => {
    const { createDurableJob, requestJobCancellation } = await import("@/lib/agent/durable-jobs")
    const { runNextDurableJob } = await import("@/lib/agent/job-worker")
    const { prisma } = await import("@/lib/prisma")
    const job = await createDurableJob(userId, input())
    await runNextDurableJob("cancel-worker", async (run) => {
      await requestJobCancellation(userId, job.id)
      await new Promise<void>((resolve) => {
        if (run.signal?.aborted) return resolve()
        run.signal?.addEventListener("abort", () => resolve(), { once: true })
      })
      throw new DOMException("Cancelled", "AbortError")
    })
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("cancelled")
  })

  it("persists suspension and a decision, then resumes through a new worker", async () => {
    const { createDurableJob } = await import("@/lib/agent/durable-jobs")
    const { runNextDurableJob } = await import("@/lib/agent/job-worker")
    const { JobSuspended } = await import("@/lib/agent/job-signals")
    const { applyOwnedIntervention } = await import("@/lib/agent/intervention-service")
    const { prisma } = await import("@/lib/prisma")
    const job = await createDurableJob(userId, input())
    await runNextDurableJob("pause-worker", async (_run, hooks) => {
      hooks?.onInterventionPending?.({ sessionId: job.id, nodeId: "review-3", reason: "Review fixture", status: "pending_approval" })
      throw new JobSuspended()
    })
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("waiting_for_input")
    await expect(applyOwnedIntervention(userId, job.id, "review-3", { action: "approve" })).resolves.toMatchObject({ duplicate: false })
    await expect(applyOwnedIntervention(userId, job.id, "review-3", { action: "approve" })).resolves.toMatchObject({ duplicate: true })
    await runNextDurableJob("resume-worker", async () => ({ final: "Approved", nodes: [], sources: [], status: "done" }))
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("completed")
    expect(await prisma.agentIntervention.count({ where: { jobId: job.id } })).toBe(1)
  })

  it("restores a checkpoint between two independent Node processes", async () => {
    const { createDurableJob } = await import("@/lib/agent/durable-jobs")
    const { prisma } = await import("@/lib/prisma")
    const conversation = await prisma.conversation.create({ data: { userId } })
    const document = await prisma.document.create({ data: { conversationId: conversation.id, content: "Synthetic second page text." } })
    const job = await createDurableJob(userId, input())
    const run = promisify(execFile)
    const fixture = path.resolve("src/lib/__tests__/fixtures/job-process.ts")
    const env = { ...process.env, FIXTURE_DOCUMENT_ID: document.id }
    await run(process.execPath, ["--import", "tsx", fixture, "checkpoint"], { env })
    await prisma.agentJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } })
    await run(process.execPath, ["--import", "tsx", fixture, "resume"], { env })
    const restored = await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })
    expect(restored.status).toBe("completed")
    expect(restored.attempt).toBe(2)
    expect(restored.result).toMatchObject({ nodes: [expect.objectContaining({ id: "saved-node", status: "done" }), expect.objectContaining({ id: "remaining-node", status: "done" })] })
  })

  it("persists an assistant answer atomically with the terminal event", async () => {
    const { createDurableJob } = await import("@/lib/agent/durable-jobs")
    const { runNextDurableJob } = await import("@/lib/agent/job-worker")
    const { prisma } = await import("@/lib/prisma")
    const conversation = await prisma.conversation.create({ data: { userId } })
    const assistantMessageId = randomUUID()
    await createDurableJob(userId, { ...input(), conversationId: conversation.id, assistantMessageId })
    await runNextDurableJob("message-worker", async () => ({ final: "Persisted fixture answer", nodes: [], sources: [], status: "done" }))
    expect((await prisma.message.findUniqueOrThrow({ where: { id: assistantMessageId } })).content).toBe("Persisted fixture answer")
  })

  it("claims a pending task once when two workers poll together", async () => {
    const { createDurableJob, claimNextJob, commitWorkerEvent, terminalPatch } = await import("@/lib/agent/durable-jobs")
    await createDurableJob(userId, input())
    const claims = await Promise.all([claimNextJob("concurrent-a"), claimNextJob("concurrent-b")])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claimed = claims.find(Boolean)!
    await commitWorkerEvent(claimed.id, claimed.leaseOwner!, "job_completed", { final: "Fixture", nodes: [], sources: [] }, undefined, terminalPatch("completed"))
  })

  it("stops recovery at its persisted attempt cap", async () => {
    const { createDurableJob, claimNextJob, retryDurableJob } = await import("@/lib/agent/durable-jobs")
    const { prisma } = await import("@/lib/prisma")
    const job = await createDurableJob(userId, input())
    await prisma.agentJob.update({ where: { id: job.id }, data: { status: "running", attempt: 3, leaseExpiresAt: new Date(0) } })
    expect(await claimNextJob("bounded-worker")).toBeNull()
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("failed")
    await expect(retryDurableJob(userId, job.id)).rejects.toThrow("JobNotRetryable")
  })

  it("reconnects to the actual SSE route from a stable cursor without execution", async () => {
    const { createDurableJob } = await import("@/lib/agent/durable-jobs")
    const { runNextDurableJob } = await import("@/lib/agent/job-worker")
    const { prisma } = await import("@/lib/prisma")
    const { GET } = await import("@/app/api/agent/jobs/[id]/events/route")
    const job = await createDurableJob(userId, input())
    await runNextDurableJob("sse-worker", async () => ({ final: "SSE fixture", nodes: [], sources: [], status: "done" }))
    const context = { params: Promise.resolve({ id: job.id }) }
    const response = await GET(new Request(`http://localhost/api/agent/jobs/${job.id}/events`, { headers: { "last-event-id": `${job.id}:1` } }), context)
    expect(response.headers.get("content-type")).toBe("text/event-stream")
    const text = await response.text()
    expect(text).toContain(`id: ${job.id}:2`)
    expect(text).not.toContain('"type":"job_created"')
    expect(text).toContain('"type":"job_completed"')
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).attempt).toBe(1)
  })

  it("records failure and allows a bounded explicit retry", async () => {
    const { createDurableJob, retryDurableJob } = await import("@/lib/agent/durable-jobs")
    const { runNextDurableJob } = await import("@/lib/agent/job-worker")
    const { prisma } = await import("@/lib/prisma")
    const job = await createDurableJob(userId, input())
    await runNextDurableJob("failing-worker", async () => { throw new Error("Fixture model timeout") })
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("failed")
    await retryDurableJob(userId, job.id)
    await runNextDurableJob("retry-worker", async () => ({ final: "Retried", nodes: [], sources: [], status: "done" }))
    expect((await prisma.agentJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("completed")
  })
})
