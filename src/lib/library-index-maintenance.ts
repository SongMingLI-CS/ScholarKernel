import { LIBRARY_CHUNK_VERSION, LIBRARY_PARSER_VERSION } from "@/lib/library-index"

export type LibraryIndexMaintenanceCandidate = {
  id: string
  indexStatus: string
  indexJobId?: string | null
  fileHash?: string | null
  parserVersion?: string | null
  chunkVersion?: string | null
  embeddingModelVersion?: string | null
  embeddingStatus?: string | null
}

export function libraryDocumentNeedsMaintenance(
  document: LibraryIndexMaintenanceCandidate,
  embeddingModelVersion: string | null
): boolean {
  if (document.indexStatus === "pending" && document.indexJobId) return false
  if (document.indexStatus === "failed") return true
  if (!document.fileHash) return true
  if (document.parserVersion !== LIBRARY_PARSER_VERSION || document.chunkVersion !== LIBRARY_CHUNK_VERSION) return true
  if (!embeddingModelVersion) return false
  return document.embeddingModelVersion !== embeddingModelVersion || document.embeddingStatus !== "ready"
}

export function selectLibraryMaintenanceBatch(
  documents: LibraryIndexMaintenanceCandidate[],
  embeddingModelVersion: string | null,
  limit: number
): LibraryIndexMaintenanceCandidate[] {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)))
  return documents.filter((document) => libraryDocumentNeedsMaintenance(document, embeddingModelVersion)).slice(0, boundedLimit)
}
