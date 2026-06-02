import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { signIn } from "@/auth"
import { isAuthEnabled } from "@/lib/session-auth"
import { AuthError } from "next-auth"

type LoginBody = { password?: string }

export async function POST(req: Request) {
  if (!isAuthEnabled()) {
    return jsonError("Auth is not enabled", 503)
  }

  const body = await parseJsonBody<LoginBody>(req)
  const password = typeof body?.password === "string" ? body.password : ""
  if (!password.trim()) return jsonError("Password is required", 400)

  try {
    await signIn("credentials", { password, redirect: false })
    return jsonOk({ ok: true, authEnabled: true })
  } catch (e) {
    if (e instanceof AuthError) {
      return jsonError("Invalid password", 401)
    }
    console.error("[POST /api/auth/login]", e)
    return jsonError("Login failed", 500)
  }
}
