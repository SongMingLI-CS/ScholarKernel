import { prisma } from "@/lib/prisma"
import { serializeAgentJobError } from "@/lib/agent-job-errors"
import {
  mergePeerReviewCheckpoint,
  parsePeerReviewCheckpoint,
  peerReviewCheckpointToJobPatch,
  type PeerReviewCheckpointData,
} from "@/lib/agent/peer-review-checkpoint"
import type { AgentJob, Prisma } from "../../generated/prisma/client"
import type { ActiveProviderConfig } from "@/lib/agent/planner"

export type { PeerReviewCheckpointData } from "@/lib/agent/peer-review-checkpoint"

export type AgentJobCheckpoint = {
  phase: "planning" | "running" | "done" | "error"
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

/**
 * 把错误写进 job 时**合并**已有 checkpoint，而不是整体替换。
 *
 * 之前的实现直接把传入的 checkpoint 覆盖上去，而调用方习惯传 `{ phase: "error" }`，
 * 于是 `peerReview` 里已完成的 reviewer 文本一起被抹掉 —— 断点续跑随即失效，
 * 恢复时会为同一份产出再付一次 LLM 费用。
 */
function mergeErrorCheckpoint(
  prev: unknown,
  patch: AgentJobCheckpoint | undefined
): AgentJobCheckpoint {
  const base = prev && typeof prev === "object" ? (prev as AgentJobCheckpoint) : undefined
  return { ...(base ?? {}), ...(patch ?? {}), phase: "error" }
}

export async function failAgentJob(
  id: string,
  error: unknown,
  checkpoint?: AgentJobCheckpoint
) {
  const { errorMessage, errorStack } = serializeAgentJobError(error)

  let existing: AgentJob | null = null
  try {
    existing = await prisma.agentJob.findUnique({ where: { id } })
  } catch {
    // 读不到历史 checkpoint 不能阻断「把错误写进去」这件更重要的事
    existing = null
  }

  /**
   * 终态不可逆：已经 `done` 的任务不能被事后错误改写。
   *
   * 触发路径是真实的：`/api/agent/run` 用 `void persistAgentJobError(...)` 做
   * fire-and-forget，与 `completeAgentJob` 没有顺序保证。一次成功完成的运行，
   * 只要收尾（写消息 / 断流 / 客户端 abort）里抛错，就会被写成
   * `status="error"` + `result` 仍在 + `checkpoint.phase="error"` 的自相矛盾记录：
   * 既不能被断点续跑（phase 已 error），也不能被信任（结果在但状态是失败）。
   */
  if (existing?.status === "done") {
    console.warn("[failAgentJob] job already done, skip error write:", id)
    return existing
  }

  const prev = existing?.checkpoint
  const shouldWriteCheckpoint = Boolean(prev) || Boolean(checkpoint)

  return prisma.agentJob.update({
    where: { id },
    data: {
      status: "error",
      error: errorMessage,
      errorMessage,
      errorStack: errorStack || null,
      ...(shouldWriteCheckpoint
        ? { checkpoint: mergeErrorCheckpoint(prev, checkpoint) as Prisma.InputJsonValue }
        : {}),
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
        // 与 failAgentJob 同一条铁律：已完成的任务不被事后错误改写。
        // 这里必须 `return` 而不是继续往下走 —— 否则会顺手把另一条活跃任务标成失败。
        if (owned.status === "done") {
          console.warn("[persistAgentJobError] job already done, skip:", ctx.jobId)
          return
        }
        await prisma.agentJob.update({
          where: { id: ctx.jobId },
          data: {
            status: "error",
            error: errorMessage,
            errorMessage,
            errorStack: errorStack || null,
            checkpoint: mergeErrorCheckpoint(owned.checkpoint, { phase: "error" }) as Prisma.InputJsonValue,
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
          checkpoint: mergeErrorCheckpoint(active.checkpoint, { phase: "error" }) as Prisma.InputJsonValue,
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
