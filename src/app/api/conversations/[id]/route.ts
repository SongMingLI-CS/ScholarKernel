import { NextResponse } from "next/server"

import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserId } from "@/lib/auth-user"
import type { ConversationPatchBody } from "@/lib/db-types"
import { prisma } from "@/lib/prisma"

type RouteCtx = { params: Promise<{ id: string }> }

async function findOwnedConversation(id: string) {
  const userId = resolveUserId()
  return prisma.conversation.findFirst({
    where: { id, ...conversationOwnerWhere(userId) },
    select: { id: true },
  })
}

export async function GET(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  try {
    const userId = resolveUserId()
    const conversation = await prisma.conversation.findFirst({
      where: { id, ...conversationOwnerWhere(userId) },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    })
    if (!conversation) return jsonError("Conversation not found", 404)
    return jsonOk(conversation)
  } catch (e) {
    console.error("[GET /api/conversations/[id]]", e)
    return jsonError("Failed to fetch conversation", 500)
  }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  const body = await parseJsonBody<ConversationPatchBody>(req)
  if (!body || (body.title === undefined && body.isPinned === undefined)) {
    return jsonError("Invalid patch body", 400)
  }

  try {
    const existing = await findOwnedConversation(id)
    if (!existing) return jsonError("Conversation not found", 404)

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() || "新对话" } : {}),
        ...(body.isPinned !== undefined ? { isPinned: body.isPinned } : {}),
      },
      select: {
        id: true,
        title: true,
        isPinned: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    return jsonOk(conversation)
  } catch (e) {
    console.error("[PATCH /api/conversations/[id]]", e)
    return jsonError("Failed to update conversation", 500)
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  try {
    const existing = await findOwnedConversation(id)
    if (!existing) return jsonError("Conversation not found", 404)

    await prisma.conversation.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.error("[DELETE /api/conversations/[id]]", e)
    return jsonError("Failed to delete conversation", 500)
  }
}
