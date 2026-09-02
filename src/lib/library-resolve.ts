import { parseLayoutAwareDocument } from "@/lib/document/layout-aware-parser"
import { formatLibraryContextBlock } from "@/lib/my-library"
import { readLibraryFile, resolveStoredFilePath } from "@/lib/library-storage"
import { prisma } from "@/lib/prisma"

export async function loadLibraryDocumentsForUser(
  userId: string,
  documentIds: string[]
): Promise<Array<{ id: string; title: string; fileType: string; text: string }>> {
  const ids = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) return []

  const rows = await prisma.document.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, title: true, fileType: true, fileUrl: true },
  })

  const out: Array<{ id: string; title: string; fileType: string; text: string }> = []
  for (const row of rows) {
    const abs = resolveStoredFilePath(row.fileUrl)
    if (!abs) continue
    const buf = readLibraryFile(abs)
    if (!buf) continue

    let text = ""
    try {
      const parsed = await parseLayoutAwareDocument({
        buffer: buf,
        filename: row.title,
      })
      text = parsed.ragContext?.trim() || parsed.text?.trim() || ""
    } catch {
      text = buf.toString("utf8")
    }
    if (!text.trim()) continue
    out.push({ id: row.id, title: row.title, fileType: row.fileType, text })
  }
  return out
}

export async function buildLibraryContextForAgent(
  userId: string | undefined,
  documentIds: string[] | undefined
): Promise<string> {
  if (!userId || !documentIds?.length) return ""
  const docs = await loadLibraryDocumentsForUser(userId, documentIds)
  return formatLibraryContextBlock(docs)
}
