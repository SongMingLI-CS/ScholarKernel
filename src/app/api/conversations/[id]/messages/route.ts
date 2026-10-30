import { logDiagnosticError } from "@/lib/diagnostics"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import type { CreateMessageBody } from "@/lib/db-types"
import { prisma } from "@/lib/prisma"
import { saveOwnedMessage, MessageWriteError } from "@/lib/owned-messages"

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteCtx) {
  const { id: conversationId } = await ctx.params
  const body = await parseJsonBody<CreateMessageBody>(req)

  if (!body?.role || typeof body.content !== "string") {
    return jsonError("Invalid message body", 400)
  }

  const role = body.role
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return jsonError("Invalid message role", 400)
  }

  try {
    const userId = await resolveUserIdFromRequest(req)
    if (!userId) return jsonError("Unauthorized", 401)
    const message = await saveOwnedMessage(userId, conversationId, body)

    return jsonOk(message, { status: 201 })
  } catch (e) {
    if (e instanceof MessageWriteError) return jsonError(e.message, e.status)
    if (e && typeof e === "object" && "code" in e && e.code === "P2002") return jsonError("Message ID already exists", 409)
    logDiagnosticError("[POST /api/conversations/[id]/messages]", e)
    return jsonError("Failed to append message", 500)
  }
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const { id: conversationId } = await ctx.params

  try {
    const userId = await resolveUserIdFromRequest(req)
    if (!userId) return jsonError("Unauthorized", 401)
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ...conversationOwnerWhere(userId) },
      select: { id: true },
    })
    if (!conversation) return jsonError("Conversation not found", 404)

    await prisma.$transaction([
      prisma.message.deleteMany({ where: { conversationId } }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ])

    return new Response(null, { status: 204 })
  } catch (e) {
    logDiagnosticError("[DELETE /api/conversations/[id]/messages]", e)
    return jsonError("Failed to clear messages", 500)
  }
}
