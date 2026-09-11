import { after } from "next/server"

import { claimAgentJobRun, completeAgentJob, createAgentJob, failAgentJob, withAgentJobHeartbeat } from "@/lib/agent-jobs"
import { configuredEmbeddingProvider, type EmbeddingProvider } from "@/lib/embedding-provider"
import { indexLibraryDocumentBuffer, libraryIndexFingerprint, libraryIndexNeedsRebuild } from "@/lib/library-index"
import { readStoredLibraryObject } from "@/lib/library-storage"
import { prisma } from "@/lib/prisma"

export async function runLibraryIndexJob(
  jobId: string,
  userId: string,
  documentId: string,
  requestScopedEmbeddingProvider?: EmbeddingProvider | null
): Promise<void> {
  if (!await claimAgentJobRun(jobId, 300_000)) return
  await withAgentJobHeartbeat(jobId, async () => {
    try {
      const document = await prisma.document.findFirst({ where: { id: documentId, userId } })
      if (!document) throw new Error("LibraryDocumentNotFound")
      const buffer = await readStoredLibraryObject(document.fileUrl)
      if (!buffer) throw new Error("LibraryObjectNotFound")
      const provider = requestScopedEmbeddingProvider === undefined
        ? configuredEmbeddingProvider()
        : requestScopedEmbeddingProvider
      const desired = libraryIndexFingerprint(buffer, provider?.modelVersion)
      const chunkCount = await prisma.documentChunk.count({ where: { documentId } })
      const reusable = chunkCount > 0 && !libraryIndexNeedsRebuild({
        fileHash: document.fileHash,
        parserVersion: document.parserVersion,
        chunkVersion: document.chunkVersion,
        embeddingModelVersion: document.embeddingModelVersion,
      }, desired)
      if (reusable) {
        await prisma.document.update({
          where: { id: documentId },
          data: { indexStatus: "ready", indexError: null },
        })
        await completeAgentJob(jobId, { final: "Library index already current", nodes: [], sources: [] })
        return
      }
      const result = await indexLibraryDocumentBuffer({
        documentId,
        documentTitle: document.title,
        filename: document.title,
        fileType: document.fileType,
        buffer,
        embeddingProvider: provider,
      })
      if (result.status === "failed") throw new Error(result.error ?? "LibraryIndexFailed")
      await completeAgentJob(jobId, {
        final: `Library indexed (${result.chunks.length} chunks; embeddings=${result.embeddingStatus ?? "unavailable"})`,
        nodes: [],
        sources: [],
      })
    } catch (error) {
      await prisma.document.update({ where: { id: documentId }, data: { indexStatus: "failed", indexError: error instanceof Error ? error.message : "LibraryIndexFailed" } }).catch(() => undefined)
      await failAgentJob(jobId, error)
    }
  }, { intervalMs: 30_000, leaseMs: 300_000 })
}

export async function scheduleLibraryIndexJob(userId: string, documentId: string): Promise<string> {
  const embeddingProvider = configuredEmbeddingProvider()
  const job = await createAgentJob(userId, {
    userInput: `library-index:${documentId}`,
    provider: { kind: "library-index", documentId },
  })
  await prisma.document.update({ where: { id: documentId }, data: { indexJobId: job.id, indexStatus: "pending", indexError: null } })
  after(() => runLibraryIndexJob(job.id, userId, documentId, embeddingProvider))
  return job.id
}
