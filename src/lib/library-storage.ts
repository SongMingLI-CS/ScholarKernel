import path from "node:path"
import fs from "node:fs"
import { del, get, put } from "@vercel/blob"

const LIBRARY_ROOT = path.join(process.cwd(), "data", "library")
const OBJECT_REFERENCE_PREFIX = "object://"

export class LibraryStorageNotConfiguredError extends Error {
  constructor() {
    super("Library object storage is not configured. Set BLOB_READ_WRITE_TOKEN or Vercel Blob OIDC settings.")
    this.name = "LibraryStorageNotConfiguredError"
  }
}

export type LibraryObjectPutInput = {
  key: string
  data: Buffer
  contentType: string
}

export type LibraryObjectStorage = {
  put(input: LibraryObjectPutInput): Promise<{ key: string }>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
}

class VercelBlobLibraryStorage implements LibraryObjectStorage {
  async put(input: LibraryObjectPutInput): Promise<{ key: string }> {
    const blob = await put(input.key, input.data, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: input.contentType,
    })
    return { key: blob.pathname }
  }

  async get(key: string): Promise<Buffer | null> {
    const result = await get(key, { access: "private" })
    if (!result?.stream) return null
    return Buffer.from(await new Response(result.stream).arrayBuffer())
  }

  async delete(key: string): Promise<void> {
    await del(key)
  }
}

let storageOverride: LibraryObjectStorage | null | undefined

function hasVercelBlobConfiguration(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      (process.env.VERCEL_OIDC_TOKEN?.trim() && process.env.BLOB_STORE_ID?.trim())
  )
}

function activeObjectStorage(): LibraryObjectStorage {
  if (storageOverride !== undefined) {
    if (storageOverride === null) throw new LibraryStorageNotConfiguredError()
    return storageOverride
  }
  if (!hasVercelBlobConfiguration()) throw new LibraryStorageNotConfiguredError()
  return new VercelBlobLibraryStorage()
}

/** Test seam; undefined restores environment-based provider resolution. */
export function setLibraryObjectStorageForTests(storage: LibraryObjectStorage | null | undefined): void {
  storageOverride = storage
}

function sanitizeObjectSegment(value: string): string {
  const safe = value.trim().replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "")
  return safe || "unnamed"
}

function objectKey(input: { userId: string; documentId: string; filename: string }): string {
  return [
    "users",
    sanitizeObjectSegment(input.userId),
    "documents",
    sanitizeObjectSegment(input.documentId),
    sanitizeObjectSegment(input.filename),
  ].join("/")
}

export function encodeLibraryObjectReference(key: string): string {
  return `${OBJECT_REFERENCE_PREFIX}${key}`
}

export function decodeLibraryObjectReference(reference: string): string | null {
  if (!reference.startsWith(OBJECT_REFERENCE_PREFIX)) return null
  const key = reference.slice(OBJECT_REFERENCE_PREFIX.length)
  if (!key || key.startsWith("/") || key.split("/").some((segment) => segment === "..")) return null
  return key
}

export async function storeLibraryObject(input: {
  userId: string
  documentId: string
  filename: string
  data: Buffer
  contentType: string
}): Promise<string> {
  const storage = activeObjectStorage()
  const stored = await storage.put({
    key: objectKey(input),
    data: input.data,
    contentType: input.contentType,
  })
  return encodeLibraryObjectReference(stored.key)
}

export async function readStoredLibraryObject(reference: string): Promise<Buffer | null> {
  const key = decodeLibraryObjectReference(reference)
  if (key) return activeObjectStorage().get(key)
  const legacyPath = resolveStoredFilePath(reference)
  return legacyPath ? readLibraryFile(legacyPath) : null
}

export async function deleteStoredLibraryObject(reference: string): Promise<void> {
  const key = decodeLibraryObjectReference(reference)
  if (key) {
    await activeObjectStorage().delete(key)
    return
  }
  const legacyPath = resolveStoredFilePath(reference)
  if (legacyPath) deleteLibraryFile(legacyPath)
}

export function libraryDirForUser(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "_")
  return path.join(LIBRARY_ROOT, safe)
}

export function libraryFilePath(userId: string, documentId: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_")
  return path.join(libraryDirForUser(userId), `${documentId}_${safeName}`)
}

export function ensureLibraryDir(userId: string): string {
  const dir = libraryDirForUser(userId)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function writeLibraryFile(userId: string, documentId: string, filename: string, data: Buffer): string {
  ensureLibraryDir(userId)
  const abs = libraryFilePath(userId, documentId, filename)
  fs.writeFileSync(abs, data)
  return abs
}

export function readLibraryFile(absPath: string): Buffer | null {
  try {
    if (!fs.existsSync(absPath)) return null
    return fs.readFileSync(absPath)
  } catch {
    return null
  }
}

export function deleteLibraryFile(absPath: string): void {
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath)
  } catch {
    // best-effort
  }
}

export function libraryFileApiUrl(documentId: string): string {
  return `/api/documents/${documentId}/file`
}

export function resolveStoredFilePath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("file://")) return null
  const abs = fileUrl.slice("file://".length)
  const root = path.resolve(LIBRARY_ROOT)
  const resolved = path.resolve(abs)
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null
  return resolved
}
