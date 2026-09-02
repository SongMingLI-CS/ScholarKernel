import { jsonError, jsonOk } from "@/lib/api-utils"
import { conversationOwnerWhere, resolveUserIdFromRequest } from "@/lib/auth-user"
import { generateShareToken, toShareLinkPayload } from "@/lib/public-share"
import { prisma } from "@/lib/prisma"

type RouteCtx = { params: Promise<{ id: string }> }

async function findOwnedCanvasDocument(req: Request, docId: string) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return { userId: null as string | null, document: null }

  const document = await prisma.canvasDocument.findFirst({
    where: {
      id: docId,
      conversation: conversationOwnerWhere(userId),
    },
    select: { id: true, isShared: true, shareToken: true },
  })
  return { userId, document }
}

export async function POST(req: Request, ctx: RouteCtx) {
  const { id: docId } = await ctx.params

  try {
    const { userId, document: existing } = await findOwnedCanvasDocument(req, docId)
    if (!userId) return jsonError("Unauthorized", 401)
    if (!existing) return jsonError("Document not found", 404)

    const shareToken = existing.isShared && existing.shareToken ? existing.shareToken : generateShareToken()
    const origin = new URL(req.url).origin

    await prisma.canvasDocument.update({
      where: { id: docId },
      data: { isShared: true, shareToken },
    })

    return jsonOk(toShareLinkPayload(origin, shareToken))
  } catch (e) {
    console.error("[POST /api/canvas/[id]/share]", e)
    return jsonError("Failed to enable share link", 500)
  }
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const { id: docId } = await ctx.params

  try {
    const { userId, document: existing } = await findOwnedCanvasDocument(req, docId)
    if (!userId) return jsonError("Unauthorized", 401)
    if (!existing) return jsonError("Document not found", 404)

    await prisma.canvasDocument.update({
      where: { id: docId },
      data: { isShared: false, shareToken: null },
    })

    return jsonOk({ revoked: true })
  } catch (e) {
    console.error("[DELETE /api/canvas/[id]/share]", e)
    return jsonError("Failed to revoke share link", 500)
  }
}
