import { prisma } from "@/lib/prisma"
import type { FileReader } from "@/lib/tools/file-tool"

/** Document ids name saved user material, never operating-system paths. */
export async function readOwnedDocument(userId: string, documentId: string) {
  if (!userId || !documentId.trim()) return { ok: false as const, error: "DocumentAccessRequired" }
  const document = await prisma.document.findFirst({
    where: { id: documentId, conversation: { userId } },
    select: { id: true, title: true, content: true, version: true },
  })
  if (!document) return { ok: false as const, error: "DocumentNotFound" }
  return { ok: true as const, documentId: document.id, title: document.title, text: document.content, version: document.version }
}

export function createOwnedDocumentReader(userId: string | undefined): FileReader {
  return async (documentId) => {
    if (!userId) return { ok: false, path: documentId, error: "DocumentAccessRequired" }
    const result = await readOwnedDocument(userId, documentId)
    return result.ok
      ? { ok: true, path: result.documentId, text: result.text }
      : { ok: false, path: documentId, error: result.error, hint: "请上传文献并使用已保存的文档 ID。" }
  }
}
