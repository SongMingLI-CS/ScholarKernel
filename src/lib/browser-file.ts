export const MAX_BROWSER_FILE_BYTES = 2 * 1024 * 1024

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".css",
  ".bib",
  ".tex",
])

const LAYOUT_AWARE_EXTENSIONS = new Set([".pdf", ".docx"])

export function isLayoutAwareUpload(name: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf(".")
  if (dot < 0) return false
  return LAYOUT_AWARE_EXTENSIONS.has(lower.slice(dot))
}

export function isLikelyTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf(".")
  if (dot >= 0) {
    const ext = lower.slice(dot)
    if (TEXT_EXTENSIONS.has(ext)) return true
    if (LAYOUT_AWARE_EXTENSIONS.has(ext)) return true
  }
  return !/\.(doc|ppt|pptx|xls|xlsx|zip|png|jpe?g|gif|webp|mp4|mp3)$/i.test(lower)
}

export function formatFileAttachmentBlock(name: string, content: string): string {
  const trimmed = content.trim()
  return [`[附件: ${name}]`, "", trimmed, "", "---", ""].join("\n")
}

async function parseLayoutAwareUpload(file: File): Promise<string> {
  const form = new FormData()
  form.append("file", file, file.name)

  const res = await fetch("/api/documents/parse", { method: "POST", body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = typeof err?.error === "string" ? err.error : `ParseFailed:${res.status}`
    throw new Error(msg)
  }
  const data = (await res.json()) as { text?: string }
  if (!data.text?.trim()) throw new Error("ParseEmpty")
  return data.text
}

export async function readBrowserFileAsText(file: File, maxBytes = MAX_BROWSER_FILE_BYTES): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error(`FileTooLarge:${file.size}`)
  }
  if (!isLikelyTextFile(file.name)) {
    throw new Error("UnsupportedFileType")
  }
  if (isLayoutAwareUpload(file.name)) {
    return await parseLayoutAwareUpload(file)
  }
  return await file.text()
}
