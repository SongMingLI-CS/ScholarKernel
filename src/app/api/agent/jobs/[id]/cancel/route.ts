import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { requestJobCancellation } from "@/lib/agent/durable-jobs"
import { jsonError, jsonOk } from "@/lib/api-utils"
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  const { id } = await context.params
  return jsonOk({ accepted: await requestJobCancellation(userId, id) })
}
