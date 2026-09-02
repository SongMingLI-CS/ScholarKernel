import { jsonError, jsonOk } from "@/lib/api-utils"
import { resolveUserIdFromRequest } from "@/lib/auth-user"
import {
  buildLibraryTagsPatch,
  inferLibraryTitle,
  serializeLibraryDocument,
  type LibraryDocumentRecord,
} from "@/lib/my-library"
import {
  deleteStoredLibraryObject,
  LibraryStorageNotConfiguredError,
  libraryFileApiUrl,
  storeLibraryObject,
} from "@/lib/library-storage"
import { prisma } from "@/lib/prisma"
import { indexLibraryDocumentBuffer } from "@/lib/library-index"

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

function parseTags(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean)
    }
  } catch {
    return raw.split(",").map((t) => t.trim()).filter(Boolean)
  }
  return []
}

function parseFolders(raw: FormDataEntryValue | null): string[] {
  return parseTags(raw)
}

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  try {
    const url = new URL(req.url)
    const folder = url.searchParams.get("folder")?.trim() || "all"

    const rows = await prisma.document.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    })

    let items: LibraryDocumentRecord[] = rows.map(serializeLibraryDocument)
    if (folder === "uncategorized") {
      items = items.filter((d) => !d.folders.length)
    } else if (folder !== "all") {
      items = items.filter((d) => d.folders.includes(folder))
    }

    return jsonOk({ items, total: items.length })
  } catch (e) {
    console.error("[GET /api/documents]", e)
    return jsonError("Failed to list documents", 500)
  }
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  try {
    const contentType = req.headers.get("content-type") ?? ""
    if (!contentType.includes("multipart/form-data")) {
      return jsonError("Expected multipart/form-data upload", 400)
    }

    const form = await req.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return jsonError("Missing file field", 400)
    if (file.size <= 0) return jsonError("Empty file", 400)
    if (file.size > MAX_UPLOAD_BYTES) return jsonError("File too large", 413)

    const titleRaw = form.get("title")
    const title =
      typeof titleRaw === "string" && titleRaw.trim()
        ? titleRaw.trim()
        : inferLibraryTitle(file.name)

    const fileType = file.type || "application/octet-stream"
    const tags = parseTags(form.get("tags"))
    const folders = parseFolders(form.get("folders"))

    const buffer = Buffer.from(await file.arrayBuffer())
    const created = await prisma.document.create({
      data: {
        userId,
        title,
        fileSize: file.size,
        fileType,
        tags,
        folders,
        fileUrl: "pending",
      },
    })

    let fileUrl: string
    try {
      fileUrl = await storeLibraryObject({
        userId,
        documentId: created.id,
        filename: file.name,
        data: buffer,
        contentType: fileType,
      })
    } catch (error) {
      await prisma.document.delete({ where: { id: created.id } }).catch(() => undefined)
      throw error
    }

    const document = await prisma.document.update({
      where: { id: created.id },
      data: { fileUrl },
    })

    await indexLibraryDocumentBuffer({
      documentId: document.id,
      documentTitle: document.title,
      filename: file.name,
      fileType,
      buffer,
    })

    return jsonOk(
      {
        ...serializeLibraryDocument(document),
        downloadUrl: libraryFileApiUrl(document.id),
      },
      { status: 201 }
    )
  } catch (e) {
    console.error("[POST /api/documents]", e)
    if (e instanceof LibraryStorageNotConfiguredError) {
      return jsonError(e.message, 503)
    }
    return jsonError("Failed to upload document", 500)
  }
}

export async function DELETE(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  try {
    const url = new URL(req.url)
    const id = url.searchParams.get("id")?.trim()
    if (!id) return jsonError("Missing id query parameter", 400)

    const existing = await prisma.document.findFirst({
      where: { id, userId },
    })
    if (!existing) return jsonError("Document not found", 404)

    await deleteStoredLibraryObject(existing.fileUrl)

    await prisma.document.delete({ where: { id } })
    return jsonOk({ deleted: true, id })
  } catch (e) {
    console.error("[DELETE /api/documents]", e)
    return jsonError("Failed to delete document", 500)
  }
}

export async function PATCH(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  try {
    const body = (await req.json().catch(() => null)) as {
      id?: string
      tags?: { add?: string[]; remove?: string[] }
      folders?: string[]
      title?: string
    } | null

    const id = body?.id?.trim()
    if (!id) return jsonError("Missing id", 400)

    const existing = await prisma.document.findFirst({ where: { id, userId } })
    if (!existing) return jsonError("Document not found", 404)

    const data: { title?: string; tags?: string[]; folders?: string[] } = {}
    if (typeof body?.title === "string") data.title = body.title.trim() || existing.title
    if (Array.isArray((body as { tagsReplace?: string[] })?.tagsReplace)) {
      data.tags = (body as { tagsReplace: string[] }).tagsReplace.map((t) => t.trim()).filter(Boolean)
    } else if (body?.tags) {
      data.tags = buildLibraryTagsPatch(existing.tags, body.tags)
    }
    if (Array.isArray(body?.folders)) {
      data.folders = body.folders.map((f) => f.trim()).filter(Boolean)
    }

    const document = await prisma.document.update({ where: { id }, data })
    return jsonOk(serializeLibraryDocument(document))
  } catch (e) {
    console.error("[PATCH /api/documents]", e)
    return jsonError("Failed to update document", 500)
  }
}
