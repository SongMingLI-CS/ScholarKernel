import { createHash, randomUUID } from "node:crypto"

import { parseLayoutAwareDocument } from "@/lib/document/layout-aware-parser"
import { prisma } from "@/lib/prisma"
import type { LibraryChunkCandidate } from "@/lib/library-rag"
import { splitLibraryChunkText } from "@/lib/library-rag"
import type { EmbeddingProvider } from "@/lib/embedding-provider"
import { EMBEDDING_DIMENSIONS, embeddingRuntimeConfig } from "@/lib/embedding-provider"
import { persistChunkEmbeddings } from "@/lib/library-vector-store"

export const LIBRARY_PARSER_VERSION = "layout-v2"
export const LIBRARY_CHUNK_VERSION = "semantic-v2"

export type LibraryIndexFingerprint = {
  fileHash: string
  parserVersion: string
  chunkVersion: string
  embeddingModelVersion: string | null
}

export function libraryIndexFingerprint(buffer: Buffer, embeddingModelVersion?: string | null): LibraryIndexFingerprint {
  return {
    fileHash: createHash("sha256").update(buffer).digest("hex"),
    parserVersion: LIBRARY_PARSER_VERSION,
    chunkVersion: LIBRARY_CHUNK_VERSION,
    embeddingModelVersion: embeddingModelVersion?.trim() || null,
  }
}

export function libraryIndexNeedsRebuild(
  existing: { fileHash?: string | null; parserVersion?: string | null; chunkVersion?: string | null; embeddingModelVersion?: string | null },
  desired: LibraryIndexFingerprint
): boolean {
  return existing.fileHash !== desired.fileHash || existing.parserVersion !== desired.parserVersion || existing.chunkVersion !== desired.chunkVersion || (existing.embeddingModelVersion ?? null) !== desired.embeddingModelVersion
}

export type LibraryIndexResult = {
  status: "ready" | "failed"
  chunks: LibraryChunkCandidate[]
  error?: string
  embeddingStatus?: "ready" | "unavailable" | "failed"
  embeddingError?: string
}

export async function indexLibraryDocumentBuffer(input: {
  documentId: string
  documentTitle: string
  filename: string
  fileType: string
  buffer: Buffer
  embeddingProvider?: EmbeddingProvider | null
}): Promise<LibraryIndexResult> {
  try {
    const fingerprint = libraryIndexFingerprint(input.buffer, input.embeddingProvider?.modelVersion)
    const parsed = await parseLayoutAwareDocument({
      buffer: input.buffer,
      filename: input.filename,
      mimeType: input.fileType,
    })
    if (!parsed.chunks.length) throw new Error("DocumentParseEmpty")

    const rows = parsed.chunks.flatMap((chunk) => {
      const contentKind = chunk.metadata.contentKind ?? "text"
      const maxChars = contentKind === "text" ? 2_400 : contentKind === "references" ? 1_600 : 3_200
      return splitLibraryChunkText(chunk.text, maxChars).map((content) => ({
        id: randomUUID(),
        documentId: input.documentId,
        section: chunk.metadata.section,
        headingPath: chunk.metadata.headingPath ?? [chunk.metadata.section],
        page: chunk.metadata.page,
        paragraphStart: chunk.metadata.paragraphStart,
        paragraphEnd: chunk.metadata.paragraphEnd,
        content,
        contentKind,
        contentHash: createHash("sha256").update(content).digest("hex"),
      }))
    }).map((chunk, chunkIndex) => ({
      ...chunk,
      chunkIndex,
      charCount: chunk.content.length,
    }))

    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId: input.documentId } }),
      prisma.documentChunk.createMany({ data: rows }),
      prisma.document.update({
        where: { id: input.documentId },
        data: {
          indexStatus: "ready", indexError: null, indexedAt: new Date(),
          fileHash: fingerprint.fileHash, parserVersion: fingerprint.parserVersion,
          chunkVersion: fingerprint.chunkVersion,
          embeddingModelVersion: fingerprint.embeddingModelVersion,
          embeddingStatus: input.embeddingProvider ? "pending" : "unavailable",
        },
      }),
    ])

    const chunks = rows.map((row) => ({
      documentId: row.documentId,
      chunkId: row.id,
      documentTitle: input.documentTitle,
      chunkIndex: row.chunkIndex,
      section: row.section,
      headingPath: row.headingPath,
      page: row.page,
      paragraphStart: row.paragraphStart,
      paragraphEnd: row.paragraphEnd,
      content: row.content,
      contentKind: row.contentKind,
    }))

    if (!input.embeddingProvider) return { status: "ready", chunks, embeddingStatus: "unavailable" }
    try {
      const provider = input.embeddingProvider
      if (provider.dimensions !== EMBEDDING_DIMENSIONS) throw new Error(`EmbeddingDimensionsMismatch:${provider.dimensions}:${EMBEDDING_DIMENSIONS}`)
      const batchSize = embeddingRuntimeConfig().batchSize
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize)
        const vectors = await provider.embed(batch.map((row) => row.content))
        if (vectors.length !== batch.length) throw new Error("EmbeddingCountMismatch")
        await persistChunkEmbeddings(batch.map((row, index) => ({
          chunkId: row.id,
          embedding: vectors[index] ?? [],
          modelVersion: provider.modelVersion,
        })))
      }
      await prisma.document.update({ where: { id: input.documentId }, data: { embeddingStatus: "ready", embeddingUpdatedAt: new Date(), embeddingModelVersion: provider.modelVersion } })
      return { status: "ready", chunks, embeddingStatus: "ready" }
    } catch (embeddingError) {
      const message = embeddingError instanceof Error ? embeddingError.message : "EmbeddingFailed"
      await prisma.document.update({ where: { id: input.documentId }, data: { embeddingStatus: "failed", indexError: `Embedding:${message}` } }).catch(() => undefined)
      return { status: "ready", chunks, embeddingStatus: "failed", embeddingError: message }
    }

    /* istanbul ignore next -- all branches return above */
    return {
      status: "ready",
      chunks,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "DocumentIndexFailed"
    await prisma.document.update({
      where: { id: input.documentId },
      data: { indexStatus: "failed", indexError: message, indexedAt: null },
    }).catch(() => undefined)
    return { status: "failed", chunks: [], error: message }
  }
}
