import { jsonError, jsonOk } from "@/lib/api-utils"
import { toPublicShareDocument } from "@/lib/public-share"
import { prisma } from "@/lib/prisma"

type RouteCtx = { params: Promise<{ token: string }> }

export async function GET(_req: Request, ctx: RouteCtx) {
  const { token } = await ctx.params
  const trimmed = token?.trim()
  if (!trimmed) return jsonError("Share link not found", 404)

  try {
    const document = await prisma.canvasDocument.findFirst({
      where: { shareToken: trimmed, isShared: true },
      select: {
        title: true,
        content: true,
        version: true,
        updatedAt: true,
      },
    })

    if (!document) return jsonError("Share link not found", 404)

    return jsonOk(toPublicShareDocument(document))
  } catch (e) {
    console.error("[GET /api/public/share/[token]]", e)
    return jsonError("Failed to load shared document", 500)
  }
}
