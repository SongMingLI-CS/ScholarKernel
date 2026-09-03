import { indexLibraryDocumentBuffer } from "@/lib/library-index"
import {
  formatRetrievedLibraryContext,
  retrieveRelevantLibraryChunks,
  type LibraryChunkCandidate,
} from "@/lib/library-rag"
import { readStoredLibraryObject } from "@/lib/library-storage"
import { prisma } from "@/lib/prisma"
import type { EvidenceStatus } from "@/lib/evidence-status"

export type LibraryResolution = {
  chunks: LibraryChunkCandidate[]
  statuses: EvidenceStatus[]
}

export async function loadLibraryChunksWithStatus(
  userId: string,
  documentIds: string[]
): Promise<LibraryResolution> {
  const ids = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))]
  if (!ids.length) return { chunks: [], statuses: [] }

  const rows = await prisma.document.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, title: true, fileType: true, fileUrl: true },
  })
  const foundIds = new Set(rows.map((row) => row.id))
  const statuses: EvidenceStatus[] = ids
    .filter((id) => !foundIds.has(id))
    .map((id) => ({
      id: `library:${id}`,
      kind: "library",
      label: id,
      state: "missing",
      detail: "Document is missing or not accessible to this user.",
    }))

  const storedChunks = await prisma.documentChunk.findMany({
    where: { documentId: { in: rows.map((row) => row.id) } },
    orderBy: [{ documentId: "asc" }, { chunkIndex: "asc" }],
  })
  const titleById = new Map(rows.map((row) => [row.id, row.title]))
  const chunks: LibraryChunkCandidate[] = storedChunks.map((chunk) => ({
    documentId: chunk.documentId,
    documentTitle: titleById.get(chunk.documentId) ?? "Untitled",
    chunkIndex: chunk.chunkIndex,
    section: chunk.section,
    page: chunk.page,
    content: chunk.content,
  }))
  const chunkCountByDocument = new Map<string, number>()
  for (const chunk of storedChunks) {
    chunkCountByDocument.set(chunk.documentId, (chunkCountByDocument.get(chunk.documentId) ?? 0) + 1)
  }

  for (const row of rows) {
    const storedCount = chunkCountByDocument.get(row.id) ?? 0
    if (storedCount > 0) {
      statuses.push({
        id: `library:${row.id}`,
        kind: "library",
        label: row.title,
        state: "loaded",
        sourceCount: storedCount,
      })
      continue
    }

    try {
      const buffer = await readStoredLibraryObject(row.fileUrl)
      if (!buffer) {
        statuses.push({
          id: `library:${row.id}`,
          kind: "library",
          label: row.title,
          state: "missing",
          detail: "Stored document object could not be found.",
        })
        continue
      }
      const indexed = await indexLibraryDocumentBuffer({
        documentId: row.id,
        documentTitle: row.title,
        filename: row.title,
        fileType: row.fileType,
        buffer,
      })
      chunks.push(...indexed.chunks)
      statuses.push({
        id: `library:${row.id}`,
        kind: "library",
        label: row.title,
        state: indexed.status === "ready" ? "loaded" : "failed",
        sourceCount: indexed.chunks.length,
        ...(indexed.error ? { detail: indexed.error } : {}),
      })
    } catch (error) {
      statuses.push({
        id: `library:${row.id}`,
        kind: "library",
        label: row.title,
        state: "failed",
        detail: error instanceof Error ? error.message : "DocumentReadFailed",
      })
    }
  }
  return { chunks, statuses }
}

export async function loadLibraryChunksForUser(
  userId: string,
  documentIds: string[]
): Promise<LibraryChunkCandidate[]> {
  return (await loadLibraryChunksWithStatus(userId, documentIds)).chunks
}

export async function resolveLibraryContextForAgent(
  userId: string | undefined,
  documentIds: string[] | undefined,
  query = ""
): Promise<{ context: string; statuses: EvidenceStatus[] }> {
  if (!userId || !documentIds?.length) return { context: "", statuses: [] }
  const { chunks, statuses } = await loadLibraryChunksWithStatus(userId, documentIds)
  return {
    context: formatRetrievedLibraryContext(
      retrieveRelevantLibraryChunks(query, chunks, { maxChunks: 10, maxChars: 12_000 })
    ),
    statuses,
  }
}

export async function buildLibraryContextForAgent(
  userId: string | undefined,
  documentIds: string[] | undefined,
  query = ""
): Promise<string> {
  return (await resolveLibraryContextForAgent(userId, documentIds, query)).context
}
