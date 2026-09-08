import { indexLibraryDocumentBuffer } from "@/lib/library-index"
import {
  formatStructuredLibraryEvidence,
  rankLibraryChunksBm25,
  reciprocalRankFusion,
  selectStructuredEvidence,
  type LibraryChunkCandidate,
  type RankedLibraryChunk,
  type StructuredLibraryEvidence,
} from "@/lib/library-rag"
import { configuredEmbeddingProvider, type EmbeddingProvider } from "@/lib/embedding-provider"
import { retrieveVectorLibraryChunks } from "@/lib/library-vector-store"
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
    chunkId: chunk.id,
    documentTitle: titleById.get(chunk.documentId) ?? "Untitled",
    chunkIndex: chunk.chunkIndex,
    section: chunk.section,
    headingPath: chunk.headingPath,
    page: chunk.page,
    paragraphStart: chunk.paragraphStart,
    paragraphEnd: chunk.paragraphEnd,
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

export type LibraryEvidenceResolution = {
  evidence: StructuredLibraryEvidence[]
  statuses: EvidenceStatus[]
  retrievalMode: "hybrid" | "lexical-degraded"
}

export async function resolveLibraryEvidenceForAgent(
  userId: string | undefined,
  documentIds: string[] | undefined,
  query = "",
  deps: {
    embeddingProvider?: EmbeddingProvider | null
    vectorRetriever?: (input: { userId: string; documentIds: string[]; queryEmbedding: number[]; limit?: number }) => Promise<RankedLibraryChunk[]>
  } = {}
): Promise<LibraryEvidenceResolution> {
  if (!userId || !documentIds?.length) return { evidence: [], statuses: [], retrievalMode: "lexical-degraded" }
  const { chunks, statuses } = await loadLibraryChunksWithStatus(userId, documentIds)
  const lexicalPromise = Promise.resolve(rankLibraryChunksBm25(query, chunks))
  const provider = deps.embeddingProvider === undefined ? configuredEmbeddingProvider() : deps.embeddingProvider
  let vectorUnavailable = !provider
  let vectorPromise: Promise<RankedLibraryChunk[]> = Promise.resolve([])
  if (provider) {
    const retriever = deps.vectorRetriever ?? retrieveVectorLibraryChunks
    vectorPromise = provider.embed([query]).then(([queryEmbedding]) => {
      if (!queryEmbedding) throw new Error("QueryEmbeddingMissing")
      return retriever({ userId, documentIds, queryEmbedding, limit: 40 })
    }).catch((error) => {
      vectorUnavailable = true
      statuses.push({
        id: "library:vector",
        kind: "library",
        label: "Vector retrieval",
        state: "degraded",
        detail: error instanceof Error ? error.message : "VectorRetrievalUnavailable",
      })
      return []
    })
  } else {
    statuses.push({
      id: "library:vector",
      kind: "library",
      label: "Vector retrieval",
      state: "degraded",
      detail: "Embedding provider is not configured; BM25 lexical retrieval remains active.",
    })
  }
  const [lexical, vector] = await Promise.all([lexicalPromise, vectorPromise])
  const positiveLexical = lexical.some((chunk) => (chunk.lexicalScore ?? 0) > 0)
    ? lexical.filter((chunk) => (chunk.lexicalScore ?? 0) > 0)
    : lexical.slice(0, 4)
  const ranked = vector.length
    ? reciprocalRankFusion(positiveLexical.slice(0, 40), vector.slice(0, 40))
    : positiveLexical.map((chunk, index) => ({ ...chunk, fusedRank: index + 1, fusedScore: 1 / (61 + index) }))
  return {
    evidence: selectStructuredEvidence(ranked, { maxChunks: 10, maxChars: 12_000, maxChunksPerDocument: 4, degraded: vectorUnavailable ? "vector-unavailable" : undefined }),
    statuses,
    retrievalMode: vectorUnavailable ? "lexical-degraded" : "hybrid",
  }
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
  const { evidence, statuses } = await resolveLibraryEvidenceForAgent(userId, documentIds, query)
  return {
    context: formatStructuredLibraryEvidence(evidence),
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
