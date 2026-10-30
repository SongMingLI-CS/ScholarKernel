import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { readOwnedDocument } from "@/lib/document-service"
import { jsonError } from "@/lib/api-utils"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  const documentId = new URL(req.url).searchParams.get("documentId")?.trim()
  if (!documentId) return jsonError("DocumentIdRequired: 请提供已保存文档的 ID。", 400)
  const result = await readOwnedDocument(userId, documentId)
  if (!result.ok) return jsonError("Document not found", 404)
  return new Response(result.text, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } })
}
