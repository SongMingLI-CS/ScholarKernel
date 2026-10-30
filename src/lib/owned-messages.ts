import { prisma } from "@/lib/prisma"
import type { CreateMessageBody } from "@/lib/db-types"

export class MessageWriteError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

export async function saveOwnedMessage(userId: string, conversationId: string, body: CreateMessageBody) {
  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } })
    if (!conversation) throw new MessageWriteError("Conversation not found", 404)
    const id = body.id?.trim() || undefined
    const metadata = body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata) ? body.metadata : undefined
    const where = { id, conversationId, conversation: { userId } }
    const existing = id ? await tx.message.findFirst({ where }) : null
    let message
    if (existing) {
      const changed = await tx.message.updateMany({ where, data: { role: body.role, content: body.content, ...(metadata ? { metadata } : {}) } })
      if (changed.count !== 1) throw new MessageWriteError("Message changed; retry the update", 409)
      message = await tx.message.findFirst({ where })
    } else {
      message = await tx.message.create({ data: { ...(id ? { id } : {}), conversationId, role: body.role, content: body.content, ...(metadata ? { metadata } : {}) } })
    }
    await tx.conversation.updateMany({ where: { id: conversationId, userId }, data: { updatedAt: new Date() } })
    return message
  })
}
