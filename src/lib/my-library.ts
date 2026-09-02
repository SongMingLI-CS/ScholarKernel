export type LibraryDocumentRecord = {
  id: string
  userId: string
  title: string
  fileUrl: string
  fileSize: number
  fileType: string
  tags: string[]
  folders: string[]
  createdAt: string
}

export type LibraryFolderFilter = "all" | "uncategorized" | string

export type AgentRunPayload = {
  userInput: string
  documentIds?: string[]
}

export type CreateLibraryDocumentInput = {
  title: string
  fileType: string
  fileSize: number
  fileUrl: string
  tags?: string[]
  folders?: string[]
}

export function serializeLibraryDocument(doc: {
  id: string
  userId: string
  title: string
  fileUrl: string
  fileSize: number
  fileType: string
  tags: string[]
  folders: string[]
  createdAt: Date
}): LibraryDocumentRecord {
  return {
    id: doc.id,
    userId: doc.userId,
    title: doc.title,
    fileUrl: doc.fileUrl,
    fileSize: doc.fileSize,
    fileType: doc.fileType,
    tags: doc.tags ?? [],
    folders: doc.folders ?? [],
    createdAt: doc.createdAt.toISOString(),
  }
}

export function filterLibraryByFolder(
  docs: LibraryDocumentRecord[],
  folder: LibraryFolderFilter
): LibraryDocumentRecord[] {
  if (folder === "all") return docs
  if (folder === "uncategorized") return docs.filter((d) => !d.folders.length)
  return docs.filter((d) => d.folders.includes(folder))
}

export function collectLibraryFolders(docs: LibraryDocumentRecord[]): string[] {
  const set = new Set<string>()
  for (const d of docs) {
    for (const f of d.folders) {
      const t = f.trim()
      if (t) set.add(t)
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh"))
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 会话上传同步到全局库时的标题推断 */
export function inferLibraryTitle(filename: string): string {
  const base = filename.trim() || "未命名文献"
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

/** 构建发往 Agent 的载荷，附带跨会话勾选的文献 ID */
export function buildAgentRunPayload(userInput: string, documentIds: string[]): AgentRunPayload {
  const ids = [...new Set(documentIds.map((id) => id.trim()).filter(Boolean))]
  return ids.length ? { userInput, documentIds: ids } : { userInput }
}

/** 校验勾选 ID 是否均属于当前用户文献库 */
export function validateLibrarySelection(
  selectedIds: string[],
  libraryDocs: LibraryDocumentRecord[]
): { ok: true; documentIds: string[] } | { ok: false; missing: string[] } {
  const owned = new Set(libraryDocs.map((d) => d.id))
  const ids = [...new Set(selectedIds.map((id) => id.trim()).filter(Boolean))]
  const missing = ids.filter((id) => !owned.has(id))
  if (missing.length) return { ok: false, missing }
  return { ok: true, documentIds: ids }
}

/** 将文献库内容块注入 Agent 会话上下文 */
export function formatLibraryContextBlock(
  docs: Array<{ title: string; fileType: string; text: string }>
): string {
  if (!docs.length) return ""
  const parts = docs.map((d, i) => {
    const body = d.text.trim().slice(0, 48_000)
    return [
      `[文献库 #${i + 1}: ${d.title} (${d.fileType})]`,
      body,
    ].join("\n")
  })
  return ["--- 我的文献库（跨会话引入）---", ...parts, "---", ""].join("\n")
}

export function buildLibraryTagsPatch(
  current: string[],
  input: { add?: string[]; remove?: string[] }
): string[] {
  const set = new Set(current.map((t) => t.trim()).filter(Boolean))
  for (const r of input.remove ?? []) {
    set.delete(r.trim())
  }
  for (const a of input.add ?? []) {
    const t = a.trim()
    if (t) set.add(t)
  }
  return [...set]
}
