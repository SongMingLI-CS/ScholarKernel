import { prisma } from "@/lib/prisma"
import { getPendingIntervention, resolveHumanInterventionSession, type HumanInterventionDecision } from "./human-intervention-gate"
import { appendJobEvent } from "./durable-jobs"

export class InterventionError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function applyOwnedIntervention(userId: string, jobId: string, nodeId: string, decision: HumanInterventionDecision) {
  const job = await prisma.agentJob.findFirst({ where: { id: jobId, userId } })
  if (!job) throw new InterventionError("Job not found", 404)
  const where = { jobId_nodeId: { jobId, nodeId } }
  const instruction = decision.action === "redirect" ? decision.instruction.trim() : null
  if (job.executionMode === "durable") {
    return prisma.$transaction(async tx => {
      const locked = await tx.agentJob.updateMany({ where: { id: jobId, userId, status: "waiting_for_input", cancelRequested: false }, data: { updatedAt: new Date() } })
      const previous = await tx.agentIntervention.findUnique({ where })
      if (previous) {
        if (previous.action !== decision.action || previous.instruction !== instruction) throw new InterventionError("A different decision has already been applied", 409)
        return { ok: true, nodeId, duplicate: true }
      }
      if (!locked.count) throw new InterventionError("Job is not waiting for input", 409)
      const current = await tx.agentJob.findUniqueOrThrow({ where: { id: jobId } })
      const checkpoint = current.checkpoint as { humanInterventionPending?: { sessionId?: string; nodeId?: string } } | null
      if (checkpoint?.humanInterventionPending?.sessionId !== jobId || checkpoint.humanInterventionPending.nodeId !== nodeId) throw new InterventionError("Job is not waiting for this node", 409)
      if (current.attempt >= current.maxAttempts) throw new InterventionError("Job attempt limit reached", 409)
      await tx.agentIntervention.create({ data: { jobId, userId, nodeId, action: decision.action, instruction } })
      await appendJobEvent(tx, jobId, "intervention_applied", { nodeId, action: decision.action, instruction }, { status: "pending" })
      return { ok: true, nodeId, duplicate: false }
    })
  }
  const previous = await prisma.agentIntervention.findUnique({ where })
  if (previous) {
    if (previous.action !== decision.action || previous.instruction !== instruction) throw new InterventionError("A different decision has already been applied", 409)
    return { ok: true, nodeId, duplicate: true }
  }
  const checkpoint = job.checkpoint as { humanInterventionPending?: { sessionId?: string; nodeId?: string } } | null
  const pending = checkpoint?.humanInterventionPending
  const gate = getPendingIntervention(jobId)
  if (job.status !== "running" || pending?.sessionId !== jobId || pending.nodeId !== nodeId || !gate || gate.nodeId !== nodeId || gate.userId !== userId || gate.jobId !== jobId) {
    throw new InterventionError("Job is not waiting for this decision", 409)
  }
  try {
    await prisma.agentIntervention.create({ data: { jobId, userId, nodeId, action: decision.action, instruction } })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const winner = await prisma.agentIntervention.findUnique({ where })
      if (winner?.action === decision.action && winner.instruction === instruction) return { ok: true, nodeId, duplicate: true }
      throw new InterventionError("A decision has already been recorded", 409)
    }
    throw error
  }
  const resolved = resolveHumanInterventionSession(jobId, decision, { userId, jobId, nodeId })
  if (!resolved.ok) throw new InterventionError("Decision saved; Job must be resumed", 409)
  return { ok: true, nodeId, duplicate: false }
}
