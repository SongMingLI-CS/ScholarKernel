import { jsonOk } from "@/lib/api-utils"

export async function GET() {
  return jsonOk({
    status: "ok",
    service: "scholarkernel-web",
    at: new Date().toISOString(),
  })
}
