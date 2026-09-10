import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { formatStructuredLibraryEvidence } from "@/lib/library-rag"
import { resolveLibraryEvidenceForAgent } from "@/lib/library-resolve"

type Body = { documentIds?: string[]; query?: string }

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const body = await parseJsonBody<Body>(req)
  const documentIds = Array.isArray(body?.documentIds)
    ? body.documentIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : []

  if (!documentIds.length) {
    return jsonOk({
      context: "",
      documentIds: [],
      retrievalMode: "lexical-degraded" as const,
      vectorEvidenceCount: 0,
    })
  }

  try {
    const resolution = await resolveLibraryEvidenceForAgent(userId, documentIds, body?.query?.trim() ?? "")
    const vectorEvidenceCount = resolution.evidence.filter(
      (item) => typeof item.vectorRank === "number"
    ).length
    return jsonOk({
      context: formatStructuredLibraryEvidence(resolution.evidence),
      documentIds,
      retrievalMode: resolution.retrievalMode,
      vectorEvidenceCount,
    })
  } catch (e) {
    console.error("[POST /api/documents/context]", e)
    return jsonError("Failed to resolve library context", 500)
  }
}
