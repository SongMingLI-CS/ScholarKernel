import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserId } from "@/lib/auth-user"
import type { CreateMessageBody } from "@/lib/db-types"
import { prisma } from "@/lib/prisma"

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
    const userId = resolveUserId()
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ...conversationOwnerWhere(userId) },
      select: { id: true },
    })
    if (!conversation) return jsonError("Conversation not found", 404)

    const messageId = body.id?.trim() || undefined
    const [message] = await prisma.$transaction([
      messageId
        ? prisma.message.upsert({
            where: { id: messageId },
            create: {
              id: messageId,
              conversationId,
              role,
              content: body.content,
            },
            update: { content: body.content, role },
          })
        : prisma.message.create({
            data: {
              conversationId,
              role,
              content: body.content,
            },
          }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ])

    return jsonOk(message, { status: 201 })
  } catch (e) {
    console.error("[POST /api/conversations/[id]/messages]", e)
    return jsonError("Failed to append message", 500)
  }
}
