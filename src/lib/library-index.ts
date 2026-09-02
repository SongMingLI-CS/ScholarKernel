import { parseLayoutAwareDocument } from "@/lib/document/layout-aware-parser"
import { prisma } from "@/lib/prisma"
import type { LibraryChunkCandidate } from "@/lib/library-rag"
import { splitLibraryChunkText } from "@/lib/library-rag"

export type LibraryIndexResult = {
  status: "ready" | "failed"
  chunks: LibraryChunkCandidate[]
  error?: string
}

export async function indexLibraryDocumentBuffer(input: {
  documentId: string
  documentTitle: string
  filename: string
  fileType: string
  buffer: Buffer
}): Promise<LibraryIndexResult> {
  try {
    const parsed = await parseLayoutAwareDocument({
      buffer: input.buffer,
      filename: input.filename,
      mimeType: input.fileType,
    })
    if (!parsed.chunks.length) throw new Error("DocumentParseEmpty")

    const rows = parsed.chunks.flatMap((chunk) =>
      splitLibraryChunkText(chunk.text).map((content) => ({
        documentId: input.documentId,
        section: chunk.metadata.section,
        page: chunk.metadata.page,
        content,
      }))
    ).map((chunk, chunkIndex) => ({
      ...chunk,
      chunkIndex,
      charCount: chunk.content.length,
    }))

    await prisma.$transaction([
      prisma.documentChunk.deleteMany({ where: { documentId: input.documentId } }),
      prisma.documentChunk.createMany({ data: rows }),
      prisma.document.update({
        where: { id: input.documentId },
        data: { indexStatus: "ready", indexError: null, indexedAt: new Date() },
      }),
    ])

    return {
      status: "ready",
      chunks: rows.map((row) => ({
        documentId: row.documentId,
        documentTitle: input.documentTitle,
        chunkIndex: row.chunkIndex,
        section: row.section,
        page: row.page,
        content: row.content,
      })),
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
