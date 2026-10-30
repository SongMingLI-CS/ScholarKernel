import { createHash } from "node:crypto"

import type { Prisma } from "../../../generated/prisma/client"
import {
  parseAcademicChunks,
  semanticChunkAcademicText,
  type AcademicChunk,
} from "@/lib/document/academic-semantic-chunker"
import { configuredLocalEmbeddingProvider } from "@/lib/document/embedding-gateway"

export const ACADEMIC_CHUNK_PARSER_VERSION = "academic-semantic-v2"

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function buildDocumentChunkRows(
  documentId: string,
  content: string,
  providedChunks?: unknown
) {
  let chunks: AcademicChunk[]
  try {
    chunks = providedChunks === undefined ? [] : parseAcademicChunks(providedChunks)
  } catch {
    chunks = []
  }
  if (!chunks.length && content.trim()) chunks = semanticChunkAcademicText({ text: content })

  const occurrences = new Map<string, number>()
  return chunks.map((chunk, chunkIndex) => {
    const text = chunk.text.trim()
    const contentHash = sha256(text)
    const identity = `${documentId}\0${chunk.metadata.section}\0${chunk.metadata.page ?? "unknown"}\0${contentHash}`
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    return {
      id: sha256(`${identity}\0${occurrence}`),
      documentId,
      chunkIndex,
      section: chunk.metadata.section,
      pageNumber: chunk.metadata.page ?? null,
      content: text,
      contentHash,
      parserVersion: ACADEMIC_CHUNK_PARSER_VERSION,
    }
  }).filter((chunk) => chunk.content.length > 0)
}

export async function replaceDocumentChunkIndex(
  tx: Prisma.TransactionClient,
  documentId: string,
  content: string,
  providedChunks?: unknown
) {
  const rows = buildDocumentChunkRows(documentId, content, providedChunks)
  await tx.documentChunk.deleteMany({ where: { documentId } })
  if (rows.length) await tx.documentChunk.createMany({ data: rows })
  return rows
}

export async function indexDocumentChunkEmbeddings(documentId: string, chunkIds: string[]) {
  const provider = configuredLocalEmbeddingProvider()
  if (!provider || !chunkIds.length) return { status: "disabled" as const }
  const { prisma } = await import("@/lib/prisma")
  const chunks = await prisma.documentChunk.findMany({
    where: { documentId, id: { in: chunkIds } },
    orderBy: { chunkIndex: "asc" },
    select: { id: true, content: true, embeddingModel: true, embeddingRevision: true, embedding: true },
  })
  const missing = chunks.filter((chunk) =>
    !chunk.embedding || chunk.embeddingModel !== provider.model || chunk.embeddingRevision !== provider.revision
  )
  if (!missing.length) return { status: "indexed" as const, count: chunks.length, model: provider.model, revision: provider.revision }

  const output = await provider.embedBatch(missing.map((chunk) => chunk.content))
  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < missing.length; index++) {
      const chunk = missing[index]!
      const vector = output.vectors[index]!
      await tx.documentChunk.updateMany({
        where: { id: chunk.id, documentId },
        data: {
          embedding: JSON.parse(JSON.stringify(vector)) as Prisma.InputJsonValue,
          embeddingModel: output.model,
          embeddingRevision: output.revision,
        },
      })
    }
  })
  return { status: "indexed" as const, count: missing.length, model: output.model, revision: output.revision }
}
