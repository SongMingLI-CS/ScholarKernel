import { prisma } from "@/lib/prisma"
import type { Prisma } from "../../generated/prisma/client"
import type { ActiveProviderConfig } from "@/lib/agent/planner"

export type AgentJobCheckpoint = {
  phase: "planning" | "running" | "done" | "error"
  nodes?: unknown[]
  partialResults?: unknown[]
  sources?: unknown[]
}

export type AgentJobProvider = ActiveProviderConfig

export type AgentJobCreateInput = {
  userInput: string
  provider: AgentJobProvider
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

export async function failAgentJob(id: string, error: string, checkpoint?: AgentJobCheckpoint) {
  return prisma.agentJob.update({
    where: { id },
    data: {
      status: "error",
      error,
      ...(checkpoint ? { checkpoint: checkpoint as Prisma.InputJsonValue } : {}),
    },
  })
}

export async function getAgentJobForUser(id: string, userId: string) {
  return prisma.agentJob.findFirst({ where: { id, userId } })
}
