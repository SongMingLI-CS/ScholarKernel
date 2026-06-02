import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { getAgentJobForUser } from "@/lib/agent-jobs"
import { jsonError, jsonOk } from "@/lib/api-utils"

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteCtx) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const { id } = await ctx.params
  const job = await getAgentJobForUser(id, userId)
  if (!job) return jsonError("Not found", 404)
  return jsonOk(job)
}
