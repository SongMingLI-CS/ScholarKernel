import { randomBytes } from "node:crypto"

/** Public page prefix — whitelisted in middleware (no auth). */
export const SHARE_PUBLIC_PAGE_PREFIX = "/share/" as const

/** Public API prefix — whitelisted in middleware (no auth). */
export const SHARE_PUBLIC_API_PREFIX = "/api/public/" as const

export type PublicShareDocument = {
  title: string
  content: string
  version: number
  updatedAt: string
}

export type ShareLinkPayload = {
  shareToken: string
  sharePath: string
  shareUrl: string
}

/** Cryptographically secure opaque share token (base64url, 256-bit entropy). */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url")
}

export function buildSharePath(token: string): string {
  return `${SHARE_PUBLIC_PAGE_PREFIX}${token}`
}

export function buildShareUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, "")
  return `${base}${buildSharePath(token)}`
}

export function isSharePublicPagePath(pathname: string): boolean {
  return pathname.startsWith(SHARE_PUBLIC_PAGE_PREFIX)
}

export function isSharePublicApiPath(pathname: string): boolean {
  return pathname.startsWith(SHARE_PUBLIC_API_PREFIX)
}

/** Strip owner/conversation identifiers before exposing to anonymous readers. */
export function toPublicShareDocument(doc: {
  title: string
  content: string
  version: number
  updatedAt: Date
}): PublicShareDocument {
  return {
    title: doc.title,
    content: doc.content,
    version: doc.version,
    updatedAt: doc.updatedAt.toISOString(),
  }
}

export function toShareLinkPayload(origin: string, token: string): ShareLinkPayload {
  return {
    shareToken: token,
    sharePath: buildSharePath(token),
    shareUrl: buildShareUrl(origin, token),
  }
}
