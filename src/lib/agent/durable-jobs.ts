import { randomUUID } from "node:crypto"
import { prisma } from "@/lib/prisma"
import type { Prisma, AgentJobStatus } from "../../../generated/prisma/client"
import type { AgentRunInput } from "@/lib/agent-server-run"

export type DurableJobInput = {
  userInput: string
  provider: AgentRunInput["activeProvider"]
  chatHistory?: AgentRunInput["chatHistory"]
  inference?: AgentRunInput["inference"]
  localOnly?: boolean
  planRetryMessage?: string
  conversationId?: string
  assistantMessageId?: string
}
export type StoredRunConfig = Pick<DurableJobInput, "chatHistory" | "inference" | "localOnly" | "planRetryMessage">
export const jsonValue = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
export const TERMINAL_JOB_STATES = new Set(["completed", "partial", "failed", "cancelled", "done", "error"])

/** Called inside a transaction: increment and insert hold the Job row lock together. */
export async function appendJobEvent(tx: Prisma.TransactionClient, jobId: string, type: string, payload: unknown, patch: Prisma.AgentJobUpdateInput = {}) {
  const job = await tx.agentJob.update({ where: { id: jobId }, data: { ...patch, eventSequence: { increment: 1 } } })
  await tx.agentJobEvent.create({ data: { jobId, sequence: job.eventSequence, type, payload: jsonValue(payload) } })
  return job
}

export async function createDurableJob(userId: string, input: DurableJobInput) {
  return prisma.$transaction(async tx => {
    if (input.conversationId) {
      const conversation = await tx.conversation.findFirst({ where: { id: input.conversationId, userId } })
      if (!conversation) throw new Error("ConversationNotFound")
      if (input.assistantMessageId) {
        const message = await tx.message.findFirst({ where: { id: input.assistantMessageId, conversationId: input.conversationId } })
        if (message && message.role !== "assistant") throw new Error("AssistantMessageRequired")
        if (!message) await tx.message.create({ data: { id: input.assistantMessageId, conversationId: input.conversationId, role: "assistant", content: "" } })
      }
    }
    const job = await tx.agentJob.create({ data: {
      userId, input: input.userInput, provider: jsonValue(input.provider), executionMode: "durable",
      conversationId: input.conversationId, assistantMessageId: input.assistantMessageId,
      runConfig: jsonValue({ chatHistory: input.chatHistory, inference: input.inference, localOnly: input.localOnly, planRetryMessage: input.planRetryMessage }),
    } })
    return appendJobEvent(tx, job.id, "job_created", { jobId: job.id, workflowVersion: 1 })
  })
}

/** Atomic claim + fencing token. Expired leases are recoverable, at most maxAttempts. */
export async function claimNextJob(workerId: string, leaseMs = 30_000) {
  return prisma.$transaction(async tx => {
    const now = new Date()
    const candidates = await tx.agentJob.findMany({
      where: { executionMode: "durable", OR: [{ status: "pending" }, { status: "running", leaseExpiresAt: { lte: now } }] },
      orderBy: { createdAt: "asc" }, take: 10,
    })
    for (const job of candidates) {
      const claim = await tx.agentJob.updateMany({
        where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
        data: { leaseOwner: `${workerId}:${randomUUID()}`, leaseExpiresAt: new Date(Date.now() + leaseMs), status: "running", attempt: { increment: job.cancelRequested || job.attempt >= job.maxAttempts ? 0 : 1 } },
      })
      if (!claim.count) continue
      if (job.cancelRequested || job.attempt >= job.maxAttempts) {
        await appendJobEvent(tx, job.id, job.cancelRequested ? "job_cancelled" : "job_failed", { reason: job.cancelRequested ? "Cancellation requested" : "Recovery attempt limit reached" }, {
          status: job.cancelRequested ? "cancelled" : "failed", leaseOwner: null, leaseExpiresAt: null, completedAt: now,
          errorMessage: job.cancelRequested ? null : "RecoveryAttemptLimitReached",
        })
        continue
      }
      return appendJobEvent(tx, job.id, job.status === "running" ? "job_recovered" : "job_started", { attempt: job.attempt + 1 })
    }
    return null
  })
}

export async function commitWorkerEvent(jobId: string, leaseOwner: string, type: string, payload: unknown, checkpoint?: unknown, patch: Prisma.AgentJobUpdateInput = {}) {
  return prisma.$transaction(async tx => {
    const owned = await tx.agentJob.updateMany({ where: { id: jobId, leaseOwner, status: "running", leaseExpiresAt: { gt: new Date() } }, data: { updatedAt: new Date() } })
    if (!owned.count) throw new Error("JobLeaseLost")
    const job = await appendJobEvent(tx, jobId, type, payload, { ...(checkpoint ? { checkpoint: jsonValue(checkpoint) } : {}), ...patch })
    if (job.conversationId && job.assistantMessageId && type === "job_completed") {
      const result = payload as { final?: string; sources?: unknown[] }
      await tx.message.updateMany({ where: { id: job.assistantMessageId, conversationId: job.conversationId, conversation: { userId: job.userId } }, data: { content: result.final ?? "", metadata: jsonValue({ sources: result.sources ?? [] }) } })
    }
    return job
  })
}

export async function heartbeatJob(jobId: string, leaseOwner: string, leaseMs = 30_000) {
  const changed = await prisma.agentJob.updateMany({ where: { id: jobId, leaseOwner, status: "running", leaseExpiresAt: { gt: new Date() } }, data: { leaseExpiresAt: new Date(Date.now() + leaseMs) } })
  if (!changed.count) return false
  const job = await prisma.agentJob.findUnique({ where: { id: jobId }, select: { cancelRequested: true } })
  return !job?.cancelRequested
}

export async function requestJobCancellation(userId: string, jobId: string) {
  return prisma.$transaction(async tx => {
    // Row lock serializes cancellation with decision and terminal transitions.
    const changed = await tx.agentJob.updateMany({ where: { id: jobId, userId, executionMode: "durable", status: { in: ["pending", "running", "waiting_for_input"] } }, data: { cancelRequested: true } })
    if (!changed.count) return false
    const job = await tx.agentJob.findUniqueOrThrow({ where: { id: jobId } })
    await appendJobEvent(tx, jobId, job.status === "running" ? "cancellation_requested" : "job_cancelled", {}, job.status === "running" ? {} : { status: "cancelled", completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null })
    return true
  })
}

export async function retryDurableJob(userId: string, jobId: string) {
  return prisma.$transaction(async tx => {
    const job = await tx.agentJob.findFirst({ where: { id: jobId, userId, executionMode: "durable" } })
    if (!job || !["failed", "partial", "cancelled"].includes(job.status) || job.attempt >= job.maxAttempts) throw new Error("JobNotRetryable")
    const changed = await tx.agentJob.updateMany({ where: { id: jobId, status: job.status, updatedAt: job.updatedAt }, data: { status: "pending", cancelRequested: false, errorMessage: null, completedAt: null } })
    if (!changed.count) throw new Error("JobStateChanged")
    return appendJobEvent(tx, jobId, "job_requeued", { attempt: job.attempt })
  })
}

export async function readJobEvents(userId: string, jobId: string, after: number, take = 100) {
  const job = await prisma.agentJob.findFirst({ where: { id: jobId, userId }, select: { id: true } })
  if (!job) throw new Error("JobNotFound")
  return prisma.agentJobEvent.findMany({ where: { jobId, sequence: { gt: after } }, orderBy: { sequence: "asc" }, take })
}

export function terminalPatch(status: AgentJobStatus): Prisma.AgentJobUpdateInput {
  return { status, leaseOwner: null, leaseExpiresAt: null, completedAt: new Date() }
}
