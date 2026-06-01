import { jsonOk } from "@/lib/api-utils"
import { isAuthEnabled, resolveSessionUserIdFromRequest } from "@/lib/session-auth"

export async function GET(req: Request) {
  const authEnabled = isAuthEnabled()
  const userId = resolveSessionUserIdFromRequest(req)
  return jsonOk({
    authEnabled,
    authenticated: authEnabled ? Boolean(userId) : true,
    userId: userId ?? null,
  })
}
