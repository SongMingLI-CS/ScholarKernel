import {
  addBM25CorpusBatch,
  createBM25CorpusStatistics,
  lexicalRerankScoresAgainstCorpus,
} from "@/lib/document/rerank-gateway"
import { buildDocumentChunkRows, indexDocumentChunkEmbeddings } from "@/lib/document/document-chunk-index"
import { cosineSimilarity, configuredLocalEmbeddingProvider, readStoredEmbedding } from "@/lib/document/embedding-gateway"
import { rerankWithLocalService } from "@/lib/document/rerank-gateway"
import { logDiagnosticError } from "@/lib/diagnostics"
import { prisma } from "@/lib/prisma"
import { fuseAcademicSearchHits } from "@/lib/tools/academic-search-strategy"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

const CHUNK_SCAN_PAGE_SIZE = 256
const DEFAULT_LOCAL_TOP_K = 8
const MAX_EVIDENCE_CHARS = 1400
const RECALL_TOP_K = 28
const MAX_LAZY_EMBEDDINGS_PER_QUERY = 128

export type LocalDocumentRetrievalStage =
  | "legacy-backfill"
  | "query-embedding"
  | "corpus-page-read"
  | "bm25-corpus-statistics"
  | "embedding-indexing"
  | "dense-score"
  | "bm25-ranking-scan"
  | "rrf"
  | "reranker"
  | "total"

export type LocalDocumentRetrievalTiming = (stage: LocalDocumentRetrievalStage, elapsedMs: number) => void

type RankedRow<Row> = { row: Row; score: number }

function keepTopRows<Row extends { id: string }>(
  current: RankedRow<Row>[],
  candidate: RankedRow<Row>,
  limit: number
) {
  current.push(candidate)
  current.sort((left, right) => right.score - left.score || left.row.id.localeCompare(right.row.id))
  if (current.length > limit) current.length = limit
}

export async function searchConversationDocumentChunks(
  userId: string,
  conversationId: string,
  query: string,
  topK = DEFAULT_LOCAL_TOP_K,
  onStageTiming?: LocalDocumentRetrievalTiming
): Promise<AcademicSearchHit[]> {
  const totalStarted = performance.now()
  const timings: Partial<Record<LocalDocumentRetrievalStage, number>> = {}
  const addTiming = (stage: LocalDocumentRetrievalStage, elapsedMs: number) => {
    timings[stage] = (timings[stage] ?? 0) + elapsedMs
  }
  const normalizedQuery = query.trim()
  if (!userId || !conversationId || !normalizedQuery) return []

  const backfillStarted = performance.now()
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
  addTiming("legacy-backfill", performance.now() - backfillStarted)

  const where = { document: { conversationId, conversation: { userId } } }
  const loadPage = (cursorId?: string) => prisma.documentChunk.findMany({
    where: { ...where, ...(cursorId ? { id: { gt: cursorId } } : {}) },
    orderBy: { id: "asc" },
    take: CHUNK_SCAN_PAGE_SIZE,
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
  type ChunkRow = Awaited<ReturnType<typeof loadPage>>[number]

  const embeddingProvider = configuredLocalEmbeddingProvider()
  let queryVector: number[] | undefined
  let queryEmbeddingModel: string | undefined
  let queryEmbeddingRevision: string | undefined
  if (embeddingProvider) {
    const started = performance.now()
    try {
      const result = await embeddingProvider.embedBatch([normalizedQuery])
      queryVector = result.vectors[0]
      queryEmbeddingModel = result.model
      queryEmbeddingRevision = result.revision
    } catch (error) {
      logDiagnosticError("[document embeddings] query embedding unavailable", error)
    }
    addTiming("query-embedding", performance.now() - started)
  }

  const corpus = createBM25CorpusStatistics()
  const lexicalCandidates: RankedRow<ChunkRow>[] = []
  const denseCandidates: RankedRow<ChunkRow>[] = []
  let cursorId: string | undefined
  let staleEmbeddingBudget = MAX_LAZY_EMBEDDINGS_PER_QUERY

  while (true) {
    const pageStarted = performance.now()
    const page = await loadPage(cursorId)
    addTiming("corpus-page-read", performance.now() - pageStarted)
    if (!page.length) break
    cursorId = page[page.length - 1]!.id

    const candidates = page.filter((row) => row.section.toLowerCase() !== "references")
    const corpusDocs = candidates.map((row) => `${row.document.title}\n${row.section}\n${row.content}`)
    const statsStarted = performance.now()
    addBM25CorpusBatch(corpus, normalizedQuery, corpusDocs)
    addTiming("bm25-corpus-statistics", performance.now() - statsStarted)

    let currentRows: ChunkRow[] = candidates
    if (embeddingProvider && queryVector && staleEmbeddingBudget > 0) {
      const stale = candidates
        .filter((row) => !row.embedding || row.embeddingModel !== embeddingProvider.model || row.embeddingRevision !== embeddingProvider.revision)
        .slice(0, staleEmbeddingBudget)
      staleEmbeddingBudget -= stale.length
      if (stale.length) {
        const indexingStarted = performance.now()
        const idsByDocument = new Map<string, string[]>()
        for (const row of stale) idsByDocument.set(row.documentId, [...(idsByDocument.get(row.documentId) ?? []), row.id])
        for (const [documentId, ids] of idsByDocument) {
          try {
            await indexDocumentChunkEmbeddings(documentId, ids)
          } catch (error) {
            logDiagnosticError("[document embeddings] lazy indexing unavailable", error)
          }
        }
        const indexed = await prisma.documentChunk.findMany({
          where: { id: { in: stale.map((row) => row.id) } },
          select: { id: true, embedding: true, embeddingModel: true, embeddingRevision: true },
        })
        const indexedById = new Map(indexed.map((row) => [row.id, row]))
        currentRows = candidates.map((row) => {
          const fresh = indexedById.get(row.id)
          return fresh ? { ...row, ...fresh } : row
        })
        addTiming("embedding-indexing", performance.now() - indexingStarted)
      }
    }

    if (embeddingProvider && queryVector && queryEmbeddingModel && queryEmbeddingRevision) {
      const denseStarted = performance.now()
      for (const row of currentRows) {
        if (row.embeddingModel !== queryEmbeddingModel || row.embeddingRevision !== queryEmbeddingRevision) continue
        const vector = readStoredEmbedding(row.embedding)
        if (!vector) continue
        const score = cosineSimilarity(queryVector, vector)
        if (Number.isFinite(score)) keepTopRows(denseCandidates, { row, score }, RECALL_TOP_K)
      }
      addTiming("dense-score", performance.now() - denseStarted)
    }
  }

  if (!corpus.documentCount) {
    addTiming("total", performance.now() - totalStarted)
    for (const [stage, elapsed] of Object.entries(timings)) onStageTiming?.(stage as LocalDocumentRetrievalStage, elapsed!)
    return []
  }

  cursorId = undefined
  while (true) {
    const pageStarted = performance.now()
    const page = await loadPage(cursorId)
    addTiming("corpus-page-read", performance.now() - pageStarted)
    if (!page.length) break
    cursorId = page[page.length - 1]!.id
    const candidates = page.filter((row) => row.section.toLowerCase() !== "references")
    const docs = candidates.map((row) => `${row.document.title}\n${row.section}\n${row.content}`)
    const scoreStarted = performance.now()
    const scored = lexicalRerankScoresAgainstCorpus(normalizedQuery, docs, corpus)
    addTiming("bm25-ranking-scan", performance.now() - scoreStarted)
    for (const row of scored) {
      if (row.score > 0) keepTopRows(lexicalCandidates, { row: candidates[row.index]!, score: row.score }, RECALL_TOP_K)
    }
  }

  const toHit = (
    row: ChunkRow,
    scores: Pick<AcademicSearchHit, "retrievalScore" | "denseScore" | "retrieverModel"> = {}
  ): AcademicSearchHit => ({
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
  })

  const lexical = lexicalCandidates.map(({ row, score }) => toHit(row, { retrievalScore: score, retrieverModel: "bm25-char-bigram-v1" }))
  const dense = denseCandidates.map(({ row, score }) => toHit(row, {
    denseScore: score,
    retrieverModel: `${queryEmbeddingModel}@${queryEmbeddingRevision}`,
  }))
  const rrfStarted = performance.now()
  const fused = fuseAcademicSearchHits([lexical, dense], Math.max(1, Math.min(20, topK)))
  addTiming("rrf", performance.now() - rrfStarted)

  const rerankStarted = performance.now()
  try {
    const reranked = await rerankWithLocalService(
      normalizedQuery,
      fused.map((hit) => [hit.title, hit.snippet].filter(Boolean).join("\n"))
    )
    if (reranked) {
      const results = [...reranked.scores]
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, Math.max(1, Math.min(20, topK)))
        .map((row, index) => ({
          ...fused[row.index]!,
          source_id: String(index + 1),
          rerankScore: row.score,
          rerankerModel: `${reranked.model}@${reranked.revision}`,
        }))
      addTiming("reranker", performance.now() - rerankStarted)
      addTiming("total", performance.now() - totalStarted)
      for (const [stage, elapsed] of Object.entries(timings)) onStageTiming?.(stage as LocalDocumentRetrievalStage, elapsed!)
      return results
    }
  } catch (error) {
    logDiagnosticError("[document reranker] local reranking unavailable", error)
  }
  addTiming("reranker", performance.now() - rerankStarted)
  addTiming("total", performance.now() - totalStarted)
  for (const [stage, elapsed] of Object.entries(timings)) onStageTiming?.(stage as LocalDocumentRetrievalStage, elapsed!)
  return fused
}
