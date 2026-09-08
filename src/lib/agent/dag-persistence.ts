import type { Prisma } from "../../../generated/prisma/client"

import type { DagNodeState } from "@/lib/agent/dag-scheduler"
import { prisma } from "@/lib/prisma"

export async function persistDagNodeStateAtomically(jobId: string, state: DagNodeState, allStates: DagNodeState[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const job = await tx.agentJob.findUnique({ where: { id: jobId }, select: { checkpoint: true } })
    const previous = job?.checkpoint && typeof job.checkpoint === "object" && !Array.isArray(job.checkpoint)
      ? job.checkpoint as Record<string, unknown>
      : {}
    const status = state.status === "pending_approval" ? "running" : state.status
    await tx.agentNode.upsert({
      where: { jobId_nodeId: { jobId, nodeId: state.node.id } },
      create: {
        jobId, nodeId: state.node.id, status,
        outputs: state.output as Prisma.InputJsonValue | undefined,
        outputSnapshot: state.output as Prisma.InputJsonValue | undefined,
        nodeSnapshot: { workflowNode: state.node } as Prisma.InputJsonValue,
        inputHash: state.inputHash, upstreamResultHash: state.upstreamResultHash,
        attemptCount: state.attemptCount, startedAt: state.startedAt, completedAt: state.completedAt,
        idempotencyKey: state.idempotencyKey, errorCategory: state.errorCategory,
        leaseExpiresAt: state.status === "running" ? new Date(Date.now() + 60_000) : null,
      },
      update: {
        status,
        outputs: state.output as Prisma.InputJsonValue | undefined,
        outputSnapshot: state.output as Prisma.InputJsonValue | undefined,
        nodeSnapshot: { workflowNode: state.node } as Prisma.InputJsonValue,
        inputHash: state.inputHash, upstreamResultHash: state.upstreamResultHash,
        attemptCount: state.attemptCount, startedAt: state.startedAt, completedAt: state.completedAt,
        idempotencyKey: state.idempotencyKey, errorCategory: state.errorCategory,
        leaseExpiresAt: state.status === "running" ? new Date(Date.now() + 60_000) : null,
      },
    })
    await tx.agentJob.update({
      where: { id: jobId },
      data: {
        heartbeatAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        checkpoint: {
          ...previous,
          phase: "running",
          nodes: allStates.map((item) => ({ ...item.node, status: item.status, output: item.output, error: item.error })),
        } as Prisma.InputJsonValue,
      },
    })
  })
}

/** Marks abandoned in-process work as recoverable error instead of leaving RUNNING forever. */
export async function recoverExpiredDagLeases(now = new Date()): Promise<number> {
  const result = await prisma.$transaction(async (tx) => {
    const expiredJobs = await tx.agentJob.findMany({
      where: { status: "running", leaseExpiresAt: { lt: now } },
      select: { id: true },
    })
    const expiredJobIds = expiredJobs.map((job) => job.id)
    if (expiredJobIds.length) {
      await tx.document.updateMany({
        where: { indexJobId: { in: expiredJobIds }, indexStatus: "pending" },
        data: { indexStatus: "failed", indexError: "PostResponseIndexLeaseExpired" },
      })
    }
    await tx.agentNode.updateMany({
      where: { status: "running", leaseExpiresAt: { lt: now } },
      data: { status: "error", errorCategory: "lease-expired", completedAt: now },
    })
    return tx.agentJob.updateMany({
      where: { status: "running", leaseExpiresAt: { lt: now } },
      data: { status: "error", error: "LeaseExpired", errorMessage: "LeaseExpired", heartbeatAt: now },
    })
  })
  return result.count
}
