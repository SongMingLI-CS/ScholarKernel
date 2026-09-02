import { indexLibraryDocumentBuffer } from "@/lib/library-index"
import {
  formatRetrievedLibraryContext,
  retrieveRelevantLibraryChunks,
  type LibraryChunkCandidate,
} from "@/lib/library-rag"
import { readStoredLibraryObject } from "@/lib/library-storage"
import { prisma } from "@/lib/prisma"

export async function loadLibraryChunksForUser(
  userId: string,
  documentIds: string[]
): Promise<LibraryChunkCandidate[]> {
  const ids = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) return []

  const rows = await prisma.document.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, title: true, fileType: true, fileUrl: true },
  })

  const storedChunks = await prisma.documentChunk.findMany({
    where: { documentId: { in: rows.map((row) => row.id) } },
    orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
  })
  const titleById = new Map(rows.map((row) => [row.id, row.title]))
  const out: LibraryChunkCandidate[] = storedChunks.map((chunk) => ({
    documentId: chunk.documentId,
    documentTitle: titleById.get(chunk.documentId) ?? "Untitled",
    chunkIndex: chunk.chunkIndex,
    section: chunk.section,
    page: chunk.page,
    content: chunk.content,
  }))
  const indexedIds = new Set(storedChunks.map((chunk) => chunk.documentId))

  for (const row of rows) {
    if (indexedIds.has(row.id)) continue
    const buf = await readStoredLibraryObject(row.fileUrl)
    if (!buf) continue
    const indexed = await indexLibraryDocumentBuffer({
      documentId: row.id,
      documentTitle: row.title,
      filename: row.title,
      fileType: row.fileType,
      buffer: buf,
    })
    out.push(...indexed.chunks)
  }
  return out
}

export async function buildLibraryContextForAgent(
  userId: string | undefined,
  documentIds: string[] | undefined,
  query = ""
): Promise<string> {
  if (!userId || !documentIds?.length) return ""
  const chunks = await loadLibraryChunksForUser(userId, documentIds)
  return formatRetrievedLibraryContext(
    retrieveRelevantLibraryChunks(query, chunks, { maxChunks: 10, maxChars: 12_000 })
  )
}
