import { Prisma } from "../../generated/prisma/client"

import { prisma } from "@/lib/prisma"
import type { LibraryChunkCandidate, RankedLibraryChunk } from "@/lib/library-rag"

type VectorRow = {
  id: string
  documentId: string
  documentTitle: string
  chunkIndex: number
  section: string
  headingPath: string[]
  page: number | null
  paragraphStart: number | null
  paragraphEnd: number | null
  content: string
  vectorScore: number
}

export function vectorLiteral(values: number[]): string {
  if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error("InvalidEmbeddingVector")
  return `[${values.join(",")}]`
}

export async function persistChunkEmbeddings(rows: Array<{ chunkId: string; embedding: number[]; modelVersion: string }>): Promise<void> {
  if (!rows.length) return
  await prisma.$transaction(rows.map((row) => prisma.$executeRaw(Prisma.sql`
    UPDATE "DocumentChunk"
    SET "embedding" = ${vectorLiteral(row.embedding)}::vector,
        "embeddingModelVersion" = ${row.modelVersion},
        "embeddedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${row.chunkId}
  `)))
}

export async function retrieveVectorLibraryChunks(input: {
  userId: string
  documentIds: string[]
  queryEmbedding: number[]
  limit?: number
}): Promise<RankedLibraryChunk[]> {
  if (!input.documentIds.length) return []
  const embedding = vectorLiteral(input.queryEmbedding)
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 40)))
  const rows = await prisma.$queryRaw<VectorRow[]>(Prisma.sql`
    SELECT c."id", c."documentId", d."title" AS "documentTitle", c."chunkIndex",
      c."section", c."headingPath", c."page", c."paragraphStart", c."paragraphEnd", c."content",
      1 - (c."embedding" <=> ${embedding}::vector) AS "vectorScore"
    FROM "DocumentChunk" c
    INNER JOIN "Document" d ON d."id" = c."documentId"
    WHERE d."userId" = ${input.userId}
      AND c."documentId" IN (${Prisma.join(input.documentIds)})
      AND c."embedding" IS NOT NULL
    ORDER BY c."embedding" <=> ${embedding}::vector
    LIMIT ${limit}
  `)
  return rows.map((row, index): RankedLibraryChunk => ({
    documentId: row.documentId,
    chunkId: row.id,
    documentTitle: row.documentTitle,
    chunkIndex: row.chunkIndex,
    section: row.section,
    headingPath: row.headingPath,
    page: row.page,
    paragraphStart: row.paragraphStart,
    paragraphEnd: row.paragraphEnd,
    content: row.content,
    vectorScore: Number(row.vectorScore),
    vectorRank: index + 1,
  }))
}

export function asVectorChunk(chunk: LibraryChunkCandidate, vectorScore: number, vectorRank: number): RankedLibraryChunk {
  return { ...chunk, vectorScore, vectorRank }
}
