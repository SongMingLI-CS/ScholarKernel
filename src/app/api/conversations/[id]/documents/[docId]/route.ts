import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import type { PatchDocumentBody } from "@/lib/db-types"
import { prisma } from "@/lib/prisma"

type RouteCtx = { params: Promise<{ id: string; docId: string }> }

async function findOwnedDocument(req: Request, conversationId: string, docId: string) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return { userId: null as string | null, document: null }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, ...conversationOwnerWhere(userId) },
    select: { id: true },
  })
  if (!conversation) return { userId, document: null }

  const document = await prisma.canvasDocument.findFirst({
    where: { id: docId, conversationId },
    select: { id: true, conversationId: true, version: true },
  })
  return { userId, document }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const { id: conversationId, docId } = await ctx.params
  const body = await parseJsonBody<PatchDocumentBody>(req)

  if (!body || (body.title === undefined && body.content === undefined)) {
    return jsonError("Invalid patch body", 400)
  }

  try {
    const { userId, document: existing } = await findOwnedDocument(req, conversationId, docId)
    if (!userId) return jsonError("Unauthorized", 401)
    if (!existing) return jsonError("Document not found", 404)

    const nextVersion =
      body.content !== undefined ? existing.version + 1 : existing.version

    const document = await prisma.canvasDocument.update({
      where: { id: docId },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() || "未命名文档" } : {}),
        ...(body.content !== undefined ? { content: body.content, version: nextVersion } : {}),
      },
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

    return jsonOk({
      ...document,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
    })
  } catch (e) {
    console.error("[PATCH /api/conversations/[id]/documents/[docId]]", e)
    return jsonError("Failed to update document", 500)
  }
}
