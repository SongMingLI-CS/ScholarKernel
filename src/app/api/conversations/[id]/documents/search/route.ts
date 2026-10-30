import { z } from "zod"

import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import { logDiagnosticError } from "@/lib/diagnostics"
import { prisma } from "@/lib/prisma"
import { searchConversationDocumentChunks } from "@/lib/document/search-conversation-chunks"

type RouteCtx = { params: Promise<{ id: string }> }
const SearchBody = z.object({ query: z.string().trim().min(1).max(1000) })

export async function POST(req: Request, ctx: RouteCtx) {
  const { id: conversationId } = await ctx.params
  const body = await parseJsonBody<unknown>(req)
  const parsed = SearchBody.safeParse(body)
  if (!parsed.success) return jsonError("Invalid search query", 400)

  try {
    const userId = await resolveUserIdFromRequest(req)
    if (!userId) return jsonError("Unauthorized", 401)
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ...conversationOwnerWhere(userId) },
      select: { id: true },
    })
    if (!conversation) return jsonError("Conversation not found", 404)
    return jsonOk(await searchConversationDocumentChunks(userId, conversationId, parsed.data.query))
  } catch (error) {
    logDiagnosticError("[POST /api/conversations/[id]/documents/search]", error)
    return jsonError("Failed to search saved documents", 500)
  }
}
