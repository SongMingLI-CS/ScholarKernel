import { jsonOk } from "@/lib/api-utils"
import { buildSessionClearCookie } from "@/lib/session-auth"

export async function POST() {
  return jsonOk(
    { ok: true },
    {
      headers: {
        "Set-Cookie": buildSessionClearCookie(),
      },
    }
  )
}
