import { apiFetch } from "@/lib/api-fetch"
import type { PublicShareDocument, ShareLinkPayload } from "@/lib/public-share"

export type { PublicShareDocument, ShareLinkPayload }

export async function enableCanvasShare(docId: string): Promise<ShareLinkPayload> {
  return apiFetch<ShareLinkPayload>(`/api/canvas/${encodeURIComponent(docId)}/share`, { method: "POST" })
}

export async function disableCanvasShare(docId: string): Promise<void> {
  await apiFetch<{ revoked: boolean }>(`/api/canvas/${encodeURIComponent(docId)}/share`, { method: "DELETE" })
}

/** Anonymous fetch — no session cookie required. */
export async function fetchPublicShareDocument(token: string): Promise<PublicShareDocument> {
  const res = await fetch(`/api/public/share/${encodeURIComponent(token)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error ?? `HTTP ${res.status}`)
  }

  return (await res.json()) as PublicShareDocument
}
