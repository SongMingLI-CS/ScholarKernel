import { indexLibraryDocumentBuffer } from "@/lib/library-index"
import {
  formatStructuredLibraryEvidence,
  libraryRetrievalPolicy,
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
import { recordOperationalMetric } from "@/lib/operational-metrics"

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
    contentKind: chunk.contentKind as LibraryChunkCandidate["contentKind"],
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
  const retrievalStartedAt = performance.now()
  const { chunks, statuses } = await loadLibraryChunksWithStatus(userId, documentIds)
  const policy = libraryRetrievalPolicy(query)
  let lexicalMs = 0
  let vectorMs = 0
  const lexicalPromise = Promise.resolve().then(() => {
    const startedAt = performance.now()
    const result = rankLibraryChunksBm25(query, chunks)
    lexicalMs = performance.now() - startedAt
    return result
  })
  const provider = deps.embeddingProvider === undefined ? configuredEmbeddingProvider() : deps.embeddingProvider
  let vectorUnavailable = !provider
  let vectorPromise: Promise<RankedLibraryChunk[]> = Promise.resolve([])
  if (provider) {
    const retriever = deps.vectorRetriever ?? retrieveVectorLibraryChunks
    vectorPromise = Promise.resolve().then(async () => {
      const startedAt = performance.now()
      const [queryEmbedding] = await provider.embed([query])
      if (!queryEmbedding) throw new Error("QueryEmbeddingMissing")
      const result = await retriever({ userId, documentIds, queryEmbedding, limit: policy.candidateLimit })
      vectorMs = performance.now() - startedAt
      return result
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
  const positiveLexical = lexical.filter((chunk) => (chunk.lexicalScore ?? 0) > 0).slice(0, policy.candidateLimit)
  const ranked = vector.length
    ? reciprocalRankFusion(positiveLexical, vector.slice(0, policy.candidateLimit), policy.rrfK)
    : positiveLexical.map((chunk, index) => ({ ...chunk, fusedRank: index + 1, fusedScore: 1 / (policy.rrfK + 1 + index) }))
  const evidence = selectStructuredEvidence(ranked, { maxChunks: policy.maxChunks, maxChars: 12_000, maxChunksPerDocument: policy.maxChunksPerDocument, degraded: vectorUnavailable ? "vector-unavailable" : undefined })
  recordOperationalMetric({
    name: "library.retrieval",
    durationMs: performance.now() - retrievalStartedAt,
    lexicalMs,
    vectorMs,
    lexicalCandidates: positiveLexical.length,
    vectorCandidates: vector.length,
    selectedEvidence: evidence.length,
    documentCount: new Set(evidence.map((item) => item.documentId)).size,
    ...(vectorUnavailable ? { degradedReason: "vector-unavailable" } : {}),
  })
  return {
    evidence,
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
