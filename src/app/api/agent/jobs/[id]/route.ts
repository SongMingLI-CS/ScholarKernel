import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { cancelAgentJob, getAgentJobForUser, getAgentJobStateForUser } from "@/lib/agent-jobs"
import { cancelActiveAgentRun } from "@/lib/agent/run-control"
import { jsonError, jsonOk } from "@/lib/api-utils"

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteCtx) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const { id } = await ctx.params
  const job = await getAgentJobStateForUser(id, userId)
  if (!job) return jsonError("Not found", 404)
  return jsonOk(job)
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  const { id } = await ctx.params
  const job = await getAgentJobForUser(id, userId)
  if (!job) return jsonError("Not found", 404)
  cancelActiveAgentRun(id)
  const checkpoint = job.checkpoint && typeof job.checkpoint === "object"
    ? job.checkpoint as import("@/lib/agent-jobs").AgentJobCheckpoint
    : undefined
  await cancelAgentJob(id, checkpoint)
  return jsonOk({ id, status: "cancelled" })
}
