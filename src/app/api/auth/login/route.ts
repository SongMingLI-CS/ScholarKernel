import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import {
  buildSessionSetCookie,
  createAuthenticatedSessionToken,
  isAuthEnabled,
  verifyPassword,
} from "@/lib/session-auth"

type LoginBody = { password?: string }

export async function POST(req: Request) {
  if (!isAuthEnabled()) {
    return jsonError("Auth is not enabled", 503)
  }

  const body = await parseJsonBody<LoginBody>(req)
  const password = typeof body?.password === "string" ? body.password : ""
  if (!password.trim()) return jsonError("Password is required", 400)
  if (!verifyPassword(password)) return jsonError("Invalid password", 401)

  const token = createAuthenticatedSessionToken()
  return jsonOk(
    { ok: true, authEnabled: true },
    {
      headers: {
        "Set-Cookie": buildSessionSetCookie(token),
      },
    }
  )
}
