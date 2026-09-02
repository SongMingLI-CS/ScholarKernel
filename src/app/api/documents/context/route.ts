import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { buildLibraryContextForAgent } from "@/lib/library-resolve"

type Body = { documentIds?: string[] }

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const body = await parseJsonBody<Body>(req)
  const documentIds = Array.isArray(body?.documentIds)
    ? body.documentIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : []

  if (!documentIds.length) return jsonOk({ context: "", documentIds: [] })

  try {
    const context = await buildLibraryContextForAgent(userId, documentIds)
    return jsonOk({ context, documentIds })
  } catch (e) {
    console.error("[POST /api/documents/context]", e)
    return jsonError("Failed to resolve library context", 500)
  }
}
