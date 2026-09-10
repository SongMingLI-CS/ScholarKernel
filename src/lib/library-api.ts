import { apiFetch } from "@/lib/api-fetch"
import type { LibraryDocumentRecord } from "@/lib/my-library"

export type LibraryListResponse = {
  items: LibraryDocumentRecord[]
  total: number
}

export async function fetchLibraryDocuments(folder = "all"): Promise<LibraryListResponse> {
  const qp = new URLSearchParams()
  if (folder && folder !== "all") qp.set("folder", folder)
  const qs = qp.toString()
  return apiFetch<LibraryListResponse>(`/api/documents${qs ? `?${qs}` : ""}`)
}

export async function uploadLibraryDocument(file: File, opts?: {
  title?: string
  tags?: string[]
  folders?: string[]
}): Promise<LibraryDocumentRecord & { downloadUrl?: string; indexJobId?: string }> {
  const form = new FormData()
  form.append("file", file, file.name)
  if (opts?.title) form.append("title", opts.title)
  if (opts?.tags?.length) form.append("tags", JSON.stringify(opts.tags))
  if (opts?.folders?.length) form.append("folders", JSON.stringify(opts.folders))

  const res = await fetch("/api/documents", { method: "POST", body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = typeof err?.error === "string" ? err.error : `HTTP ${res.status}`
    throw new Error(msg)
  }
  return (await res.json()) as LibraryDocumentRecord & { downloadUrl?: string; indexJobId?: string }
}

export async function deleteLibraryDocument(id: string): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/api/documents?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function fetchLibraryContext(documentIds: string[], query = ""): Promise<{
  context: string
  documentIds: string[]
  retrievalMode: "hybrid" | "lexical-degraded"
  vectorEvidenceCount: number
}> {
  return apiFetch("/api/documents/context", {
    method: "POST",
    body: JSON.stringify({ documentIds, ...(query.trim() ? { query: query.trim() } : {}) }),
  })
}

export async function patchLibraryDocument(
  id: string,
  patch: {
    title?: string
    tags?: { add?: string[]; remove?: string[] }
    tagsReplace?: string[]
    folders?: string[]
    reindex?: boolean
  }
): Promise<LibraryDocumentRecord> {
  return apiFetch<LibraryDocumentRecord>("/api/documents", {
    method: "PATCH",
    body: JSON.stringify({ id, ...patch }),
  })
}

export async function reindexLibraryDocument(id: string): Promise<LibraryDocumentRecord> {
  return patchLibraryDocument(id, { reindex: true })
}

export async function previewLibraryReindex(limit = 10): Promise<{ staleDocumentIds: string[]; totalScanned: number }> {
  return apiFetch(`/api/documents/reindex?limit=${Math.max(1, Math.min(50, Math.floor(limit)))}`)
}

export async function reindexStaleLibraryDocuments(limit = 10): Promise<{
  scheduled: Array<{ documentId: string; indexJobId: string }>
  remainingStale: number
}> {
  return apiFetch("/api/documents/reindex", {
    method: "POST",
    body: JSON.stringify({ limit: Math.max(1, Math.min(50, Math.floor(limit))) }),
  })
}
