import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { readLibraryFile, resolveStoredFilePath } from "@/lib/library-storage"
import { prisma } from "@/lib/prisma"

type RouteCtx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteCtx) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return new Response("Unauthorized", { status: 401 })

  const { id } = await ctx.params
  try {
    const doc = await prisma.document.findFirst({
      where: { id, userId },
      select: { fileUrl: true, fileType: true, title: true },
    })
    if (!doc) return new Response("Not found", { status: 404 })

    const abs = resolveStoredFilePath(doc.fileUrl)
    if (!abs) return new Response("File missing", { status: 404 })

    const buf = readLibraryFile(abs)
    if (!buf) return new Response("File missing", { status: 404 })

    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": doc.fileType || "application/octet-stream",
        "Content-Disposition": `inline; filename="${encodeURIComponent(doc.title)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (e) {
    console.error("[GET /api/documents/[id]/file]", e)
    return new Response("Internal error", { status: 500 })
  }
}
