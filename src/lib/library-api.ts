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
}): Promise<LibraryDocumentRecord & { downloadUrl?: string }> {
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
  return (await res.json()) as LibraryDocumentRecord & { downloadUrl?: string }
}

export async function deleteLibraryDocument(id: string): Promise<void> {
  await apiFetch<{ deleted: boolean }>(`/api/documents?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
}

export async function fetchLibraryContext(documentIds: string[]): Promise<{ context: string; documentIds: string[] }> {
  return apiFetch<{ context: string; documentIds: string[] }>("/api/documents/context", {
    method: "POST",
    body: JSON.stringify({ documentIds }),
  })
}

export async function patchLibraryDocument(
  id: string,
  patch: {
    title?: string
    tags?: { add?: string[]; remove?: string[] }
    tagsReplace?: string[]
    folders?: string[]
  }
): Promise<LibraryDocumentRecord> {
  return apiFetch<LibraryDocumentRecord>("/api/documents", {
    method: "PATCH",
    body: JSON.stringify({ id, ...patch }),
  })
}
