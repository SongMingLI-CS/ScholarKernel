import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { getUserBillingMetrics } from "@/lib/billing/billing-metrics"
import { jsonError, jsonOk } from "@/lib/api-utils"

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  try {
    const metrics = await getUserBillingMetrics(userId)
    return jsonOk(metrics)
  } catch (e) {
    console.error("[GET /api/user/billing-metrics]", e)
    return jsonError("Failed to load billing metrics", 500)
  }
}
