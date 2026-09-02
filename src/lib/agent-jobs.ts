import { prisma } from "@/lib/prisma"
import { serializeAgentJobError } from "@/lib/agent-job-errors"
import {
  mergePeerReviewCheckpoint,
  parsePeerReviewCheckpoint,
  peerReviewCheckpointToJobPatch,
  type PeerReviewCheckpointData,
} from "@/lib/agent/peer-review-checkpoint"
import type { Prisma } from "../../generated/prisma/client"
import type { ActiveProviderConfig } from "@/lib/agent/planner"
import type { NodeSnapshotRecord } from "@/lib/agent/node-resume"

export type { PeerReviewCheckpointData } from "@/lib/agent/peer-review-checkpoint"

export type AgentJobCheckpoint = {
  phase: "planning" | "running" | "done" | "error" | "cancelled"
  nodes?: unknown[]
  partialResults?: unknown[]
  sources?: unknown[]
  peerReview?: PeerReviewCheckpointData
  humanIntervention?: {
    nodeId: string
    action: "approve" | "redirect"
    instruction: string | null
    appliedAt: number
  }
  humanInterventionPending?: {
    nodeId: string
    reason: string
    sessionId: string
    at: number
  }
}

export async function cancelAgentJob(id: string, checkpoint?: AgentJobCheckpoint) {
  return prisma.agentJob.update({
    where: { id },
    data: {
      status: "cancelled",
      checkpoint: {
        ...(checkpoint ?? {}),
        phase: "cancelled",
      } as Prisma.InputJsonValue,
      error: null,
      errorMessage: null,
      errorStack: null,
    },
  })
}

export type AgentJobProvider = ActiveProviderConfig

export type AgentJobCreateInput = {
  userInput: string
  provider: AgentJobProvider
}

export type AgentJobFailInput = {
  jobId?: string
  userInput?: string
  provider?: AgentJobProvider
}

export async function createAgentJob(userId: string, input: AgentJobCreateInput) {
  return prisma.agentJob.create({
    data: {
      userId,
      status: "pending",
      input: input.userInput,
      provider: input.provider,
    },
  })
}

export async function markAgentJobRunning(id: string) {
  return prisma.agentJob.update({
    where: { id },
    data: { status: "running" },
  })
}

export async function updateAgentJobCheckpoint(id: string, checkpoint: AgentJobCheckpoint) {
  return prisma.agentJob.update({
    where: { id },
    data: { checkpoint: checkpoint as Prisma.InputJsonValue },
  })
}

/** 合并写入 Multi-Agent Peer Review 阶段快照（秒级持久化，供断点续跑）。 */
export async function updateAgentJobPeerReviewCheckpoint(
  id: string,
  baseCheckpoint: unknown,
  patch: Partial<PeerReviewCheckpointData> & { markComplete?: PeerReviewCheckpointData["completedStages"][number] }
) {
  const existing = parsePeerReviewCheckpoint(
    baseCheckpoint && typeof baseCheckpoint === "object" ? baseCheckpoint : { peerReview: null }
  )
  const merged = mergePeerReviewCheckpoint(existing, patch)
  const jobPatch = peerReviewCheckpointToJobPatch(merged)
  const prev =
    baseCheckpoint && typeof baseCheckpoint === "object" ? (baseCheckpoint as AgentJobCheckpoint) : ({} as AgentJobCheckpoint)
  return updateAgentJobCheckpoint(id, { ...prev, ...jobPatch })
}

export async function completeAgentJob(
  id: string,
  result: { final: string; nodes: unknown[]; sources: unknown[] }
) {
  return prisma.agentJob.update({
    where: { id },
    data: {
      status: "done",
      result: result as Prisma.InputJsonValue,
      checkpoint: { phase: "done", nodes: result.nodes, sources: result.sources } as Prisma.InputJsonValue,
    },
  })
}

export async function failAgentJob(
  id: string,
  error: unknown,
  checkpoint?: AgentJobCheckpoint
) {
  const { errorMessage, errorStack } = serializeAgentJobError(error)
  return prisma.agentJob.update({
    where: { id },
    data: {
      status: "error",
      error: errorMessage,
      errorMessage,
      errorStack: errorStack || null,
      ...(checkpoint ? { checkpoint: checkpoint as Prisma.InputJsonValue } : {}),
    },
  })
}

/** 异步写入 AgentJob 可观测性字段；不阻塞 API 响应。 */
export function persistAgentJobError(userId: string, error: unknown, ctx: AgentJobFailInput = {}) {
  const { errorMessage, errorStack } = serializeAgentJobError(error)
  const write = async () => {
    if (ctx.jobId) {
      const owned = await prisma.agentJob.findFirst({ where: { id: ctx.jobId, userId } })
      if (owned) {
        await prisma.agentJob.update({
          where: { id: ctx.jobId },
          data: {
            status: "error",
            error: errorMessage,
            errorMessage,
            errorStack: errorStack || null,
            checkpoint: { phase: "error" } as Prisma.InputJsonValue,
          },
        })
        return
      }
    }

    const active = await prisma.agentJob.findFirst({
      where: { userId, status: { in: ["pending", "running"] } },
      orderBy: { updatedAt: "desc" },
    })
    if (active) {
      await prisma.agentJob.update({
        where: { id: active.id },
        data: {
          status: "error",
          error: errorMessage,
          errorMessage,
          errorStack: errorStack || null,
          checkpoint: { phase: "error" } as Prisma.InputJsonValue,
        },
      })
      return
    }

    if (ctx.userInput?.trim()) {
      await prisma.agentJob.create({
        data: {
          userId,
          status: "error",
          input: ctx.userInput.trim(),
          provider: ctx.provider ?? undefined,
          error: errorMessage,
          errorMessage,
          errorStack: errorStack || null,
          checkpoint: { phase: "error" } as Prisma.InputJsonValue,
        },
      })
    }
  }

  return write().catch((e) => {
    console.error("[persistAgentJobError]", e)
  })
}

export async function updateAgentJobWorkflowTopology(
  id: string,
  nodes: unknown[],
  extra?: Partial<AgentJobCheckpoint>
) {
  const job = await prisma.agentJob.findUnique({ where: { id }, select: { checkpoint: true } })
  const prev =
    job?.checkpoint && typeof job.checkpoint === "object"
      ? (job.checkpoint as AgentJobCheckpoint)
      : ({} as AgentJobCheckpoint)
  return updateAgentJobCheckpoint(id, {
    ...prev,
    ...extra,
    phase: extra?.phase ?? prev.phase ?? "running",
    nodes,
  })
}

export async function getAgentJobForUser(id: string, userId: string) {
  return prisma.agentJob.findFirst({ where: { id, userId } })
}

/** 增量对账写入：节点 done 时 upsert 快照（outputs + nodeSnapshot）。 */
export async function upsertAgentNodeSnapshot(
  jobId: string,
  record: NodeSnapshotRecord
) {
  return prisma.agentNode.upsert({
    where: { jobId_nodeId: { jobId, nodeId: record.nodeId } },
    create: {
      jobId,
      nodeId: record.nodeId,
      status: record.status === "error" ? "error" : record.status === "done" ? "done" : "running",
      outputs: record.outputs as Prisma.InputJsonValue | undefined,
      nodeSnapshot: record.nodeSnapshot as Prisma.InputJsonValue | undefined,
    },
    update: {
      status: record.status === "error" ? "error" : record.status === "done" ? "done" : "running",
      outputs: record.outputs as Prisma.InputJsonValue | undefined,
      nodeSnapshot: record.nodeSnapshot as Prisma.InputJsonValue | undefined,
    },
  })
}

/** 异步持久化节点快照，不阻塞流式调度循环。 */
export function persistAgentNodeSnapshotAsync(jobId: string, record: NodeSnapshotRecord) {
  return upsertAgentNodeSnapshot(jobId, record).catch((e) => {
    console.error("[persistAgentNodeSnapshotAsync]", jobId, record.nodeId, e)
  })
}

/** 读取 Job 下全部节点快照，供断点续跑汇聚 Context。 */
export async function loadAgentNodeSnapshots(jobId: string): Promise<NodeSnapshotRecord[]> {
  const rows = await prisma.agentNode.findMany({
    where: { jobId },
    orderBy: { updatedAt: "asc" },
  })
  return rows.map((row) => ({
    nodeId: row.nodeId,
    status: row.status as NodeSnapshotRecord["status"],
    outputs: row.outputs ?? undefined,
    nodeSnapshot: (row.nodeSnapshot as NodeSnapshotRecord["nodeSnapshot"]) ?? undefined,
  }))
}
