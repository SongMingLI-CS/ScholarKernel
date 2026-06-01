import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import type { CreateDocumentBody } from "@/lib/db-types"
import { prisma } from "@/lib/prisma"

type RouteCtx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteCtx) {
  const { id: conversationId } = await ctx.params
  const body = await parseJsonBody<CreateDocumentBody>(req)

  try {
    const userId = resolveUserIdFromRequest(req)
    if (!userId) return jsonError("Unauthorized", 401)

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ...conversationOwnerWhere(userId) },
      select: { id: true },
    })
    if (!conversation) return jsonError("Conversation not found", 404)

    const title = typeof body?.title === "string" ? body.title.trim() || "未命名文档" : "未命名文档"
    const content = typeof body?.content === "string" ? body.content : ""

    const document = await prisma.document.create({
      data: { conversationId, title, content },
      select: {
        id: true,
        conversationId: true,
        title: true,
        content: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return jsonOk(
      {
        ...document,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      },
      { status: 201 }
    )
  } catch (e) {
    console.error("[POST /api/conversations/[id]/documents]", e)
    return jsonError("Failed to create document", 500)
  }
}
