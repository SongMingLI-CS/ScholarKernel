import path from "node:path"
import fs from "node:fs"

const LIBRARY_ROOT = path.join(process.cwd(), "data", "library")

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
