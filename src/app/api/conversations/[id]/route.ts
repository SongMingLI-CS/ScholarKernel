import { NextResponse } from "next/server"

import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import type { ConversationPatchBody } from "@/lib/db-types"
import { prisma } from "@/lib/prisma"

type RouteCtx = { params: Promise<{ id: string }> }

async function findOwnedConversation(req: Request, id: string) {
  const userId = resolveUserIdFromRequest(req)
  if (!userId) return { userId: null as string | null, row: null }
  const row = await prisma.conversation.findFirst({
    where: { id, ...conversationOwnerWhere(userId) },
    select: { id: true },
  })
  return { userId, row }
}

function parseLimit(raw: string | null, fallback = 100, max = 200) {
  const n = raw ? Number.parseInt(raw, 10) : fallback
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(max, Math.floor(n))
}

export async function GET(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  const userId = resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)
  try {
    const url = new URL(req.url)
    const paginateMessages = url.searchParams.has("msgLimit") || url.searchParams.has("msgCursor")
    const msgLimit = parseLimit(url.searchParams.get("msgLimit"))
    const msgCursor = url.searchParams.get("msgCursor")?.trim() || undefined

    const conversation = await prisma.conversation.findFirst({
      where: { id, ...conversationOwnerWhere(userId) },
      include: {
        messages: paginateMessages
          ? {
              orderBy: { createdAt: "asc" },
              take: msgLimit + 1,
              ...(msgCursor ? { cursor: { id: msgCursor }, skip: 1 } : {}),
            }
          : { orderBy: { createdAt: "asc" } },
      },
    })
    if (!conversation) return jsonError("Conversation not found", 404)

    if (!paginateMessages) {
      return jsonOk(conversation)
    }

    const { messages, ...rest } = conversation
    const hasMore = messages.length > msgLimit
    const page = hasMore ? messages.slice(0, msgLimit) : messages
    return jsonOk({
      ...rest,
      messages: page,
      messagesNextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      messagesHasMore: hasMore,
    })
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
    const { userId, row: existing } = await findOwnedConversation(req, id)
    if (!userId) return jsonError("Unauthorized", 401)
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

export async function DELETE(req: Request, ctx: RouteCtx) {
  const { id } = await ctx.params
  try {
    const { userId, row: existing } = await findOwnedConversation(req, id)
    if (!userId) return jsonError("Unauthorized", 401)
    if (!existing) return jsonError("Conversation not found", 404)

    await prisma.conversation.delete({ where: { id } })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    console.error("[DELETE /api/conversations/[id]]", e)
    return jsonError("Failed to delete conversation", 500)
  }
}
