export const MAX_BROWSER_FILE_BYTES = 512 * 1024

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

export function isLikelyTextFile(name: string): boolean {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf(".")
  if (dot >= 0) {
    const ext = lower.slice(dot)
    if (TEXT_EXTENSIONS.has(ext)) return true
  }
  return !/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|zip|png|jpe?g|gif|webp|mp4|mp3)$/i.test(lower)
}

export function formatFileAttachmentBlock(name: string, content: string): string {
  const trimmed = content.trim()
  return [`[附件: ${name}]`, "", trimmed, "", "---", ""].join("\n")
}

export async function readBrowserFileAsText(file: File, maxBytes = MAX_BROWSER_FILE_BYTES): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error(`FileTooLarge:${file.size}`)
  }
  if (!isLikelyTextFile(file.name)) {
    throw new Error("UnsupportedFileType")
  }
  return await file.text()
}
