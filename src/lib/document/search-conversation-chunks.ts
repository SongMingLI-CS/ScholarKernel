import { lexicalRerankScores } from "@/lib/document/rerank-gateway"
import { buildDocumentChunkRows, indexDocumentChunkEmbeddings } from "@/lib/document/document-chunk-index"
import { cosineSimilarity, configuredLocalEmbeddingProvider, readStoredEmbedding } from "@/lib/document/embedding-gateway"
import { rerankWithLocalService } from "@/lib/document/rerank-gateway"
import { logDiagnosticError } from "@/lib/diagnostics"
import { prisma } from "@/lib/prisma"
import { fuseAcademicSearchHits } from "@/lib/tools/academic-search-strategy"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

const MAX_INDEXED_CHUNKS_PER_SEARCH = 1000
const DEFAULT_LOCAL_TOP_K = 8
const MAX_EVIDENCE_CHARS = 1400
const RECALL_TOP_K = 28
const MAX_LAZY_EMBEDDINGS_PER_QUERY = 128

export async function searchConversationDocumentChunks(
  userId: string,
  conversationId: string,
  query: string,
  topK = DEFAULT_LOCAL_TOP_K
): Promise<AcademicSearchHit[]> {
  const normalizedQuery = query.trim()
  if (!userId || !conversationId || !normalizedQuery) return []

  const unindexed = await prisma.document.findMany({
    where: { conversationId, conversation: { userId }, chunks: { none: {} }, content: { not: "" } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: { id: true, content: true },
  })
  for (const document of unindexed) {
    const rows = buildDocumentChunkRows(document.id, document.content)
    if (rows.length) {
      await prisma.documentChunk.createMany({ data: rows, skipDuplicates: true })
      try {
        await indexDocumentChunkEmbeddings(document.id, rows.map((row) => row.id))
      } catch (error) {
        logDiagnosticError("[document embeddings] lazy backfill unavailable", error)
      }
    }
  }

  const where = { document: { conversationId, conversation: { userId } } }
  const loadRows = () => prisma.documentChunk.findMany({
      where,
      orderBy: [{ document: { updatedAt: "desc" } }, { documentId: "asc" }, { chunkIndex: "asc" }],
      take: MAX_INDEXED_CHUNKS_PER_SEARCH,
      select: {
        id: true,
        documentId: true,
        section: true,
        pageNumber: true,
        content: true,
        embedding: true,
        embeddingModel: true,
        embeddingRevision: true,
        document: { select: { id: true, title: true } },
      },
    })
  let rows = await loadRows()
  const embeddingProvider = configuredLocalEmbeddingProvider()
  if (embeddingProvider) {
    const stale = rows
      .filter((row) => !row.embedding || row.embeddingModel !== embeddingProvider.model || row.embeddingRevision !== embeddingProvider.revision)
      .slice(0, MAX_LAZY_EMBEDDINGS_PER_QUERY)
    const byDocument = new Map<string, string[]>()
    for (const row of stale) byDocument.set(row.documentId, [...(byDocument.get(row.documentId) ?? []), row.id])
    for (const [documentId, ids] of byDocument) {
      try {
        await indexDocumentChunkEmbeddings(documentId, ids)
      } catch (error) {
        logDiagnosticError("[document embeddings] lazy indexing unavailable", error)
      }
    }
    if (stale.length) rows = await loadRows()
  }

  const candidates = rows.filter((row) => row.section.toLowerCase() !== "references")
  if (!candidates.length) return []
  const documents = candidates.map((row) => `${row.document.title}\n${row.section}\n${row.content}`)
  const toHit = (index: number, scores: Pick<AcademicSearchHit, "retrievalScore" | "denseScore" | "retrieverModel"> = {}): AcademicSearchHit => {
    const row = candidates[index]!
    return {
      source_id: "",
      title: `${row.document.title} · ${row.section}`,
      url: `scholarkernel://documents/${encodeURIComponent(row.documentId)}/chunks/${encodeURIComponent(row.id)}`,
      snippet: row.content.slice(0, MAX_EVIDENCE_CHARS),
      source: "ScholarKernel local document",
      sourceKind: "local_document",
      documentId: row.documentId,
      chunkId: row.id,
      ...(row.pageNumber ? { pageNumber: row.pageNumber } : {}),
      ...scores,
    }
  }

  const lexical = lexicalRerankScores(normalizedQuery, documents)
    .filter((score) => score.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, RECALL_TOP_K)
    .map(({ index, score }) => toHit(index, { retrievalScore: score, retrieverModel: "bm25-char-bigram-v1" }))

  let dense: AcademicSearchHit[] = []
  if (embeddingProvider) {
    try {
      const queryEmbedding = await embeddingProvider.embedBatch([normalizedQuery])
      const queryVector = queryEmbedding.vectors[0]
      if (queryVector) {
        dense = candidates
          .map((row, index) => {
            if (row.embeddingModel !== queryEmbedding.model || row.embeddingRevision !== queryEmbedding.revision) return null
            const vector = readStoredEmbedding(row.embedding)
            if (!vector) return null
            const score = cosineSimilarity(queryVector, vector)
            return Number.isFinite(score) ? { index, score } : null
          })
          .filter((item): item is { index: number; score: number } => item !== null)
          .sort((a, b) => b.score - a.score || a.index - b.index)
          .slice(0, RECALL_TOP_K)
          .map(({ index, score }) => toHit(index, {
            denseScore: score,
            retrieverModel: `${queryEmbedding.model}@${queryEmbedding.revision}`,
          }))
      }
    } catch (error) {
      logDiagnosticError("[document embeddings] dense retrieval unavailable", error)
    }
  }

  const fused = fuseAcademicSearchHits([lexical, dense], Math.max(1, Math.min(20, topK)))
  try {
    const reranked = await rerankWithLocalService(
      normalizedQuery,
      fused.map((hit) => [hit.title, hit.snippet].filter(Boolean).join("\n"))
    )
    if (reranked) {
      return [...reranked.scores]
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, Math.max(1, Math.min(20, topK)))
        .map((row, index) => ({
          ...fused[row.index]!,
          source_id: String(index + 1),
          rerankScore: row.score,
          rerankerModel: `${reranked.model}@${reranked.revision}`,
        }))
    }
  } catch (error) {
    logDiagnosticError("[document reranker] local reranking unavailable", error)
  }
  return fused
}
