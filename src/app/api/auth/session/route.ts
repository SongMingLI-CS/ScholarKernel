import { jsonOk } from "@/lib/api-utils"
import { getServerSession } from "@/lib/auth-user"
import { isAuthEnabled } from "@/lib/session-auth"

export async function GET() {
  const authEnabled = isAuthEnabled()
  const session = authEnabled ? await getServerSession() : null
  const userId = session?.user?.id ?? null
  return jsonOk({
    authEnabled,
    authenticated: authEnabled ? Boolean(userId) : true,
    userId,
  })
}
