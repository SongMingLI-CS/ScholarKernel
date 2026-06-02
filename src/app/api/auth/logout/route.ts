import { jsonOk } from "@/lib/api-utils"
import { signOut } from "@/auth"

export async function POST() {
  await signOut({ redirect: false })
  return jsonOk({ ok: true })
}
