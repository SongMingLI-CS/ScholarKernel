import {
  isLayoutAwareBinaryPath,
  parseLayoutAwareDocument,
} from "@/lib/document/layout-aware-parser"

function isServer() {
  return typeof window === "undefined"
}

function normalizeRelPath(p: string) {
  return p.replace(/\\/g, "/").replace(/^\.?\//, "")
}

function isLogLikePath(p: string) {
  const n = normalizeRelPath(p)
  return n.startsWith("logs/") && n.toLowerCase().endsWith(".log")
}

function isErrnoLike(e: unknown, code: string) {
  if (!e || typeof e !== "object") return false
  const c = (e as { code?: unknown }).code
  return typeof c === "string" && c.toUpperCase() === code.toUpperCase()
}

async function readFileBuffer(abs: string): Promise<Buffer> {
  const fs = await import("node:fs")
  return fs.readFileSync(abs)
}

export async function safeReadTextFile(
  relPath: string
): Promise<
  | {
      ok: true
      path: string
      text: string
      layout?: string
      parser?: string
      chunks?: import("@/lib/document/academic-semantic-chunker").AcademicChunk[]
      ragContext?: string
    }
  | { ok: false; path: string; error: string; hint?: string }
> {
  const p = normalizeRelPath(relPath)
  if (!p || p.includes("\0")) {
    return { ok: false, path: relPath, error: "InvalidPath" }
  }
  if (!isServer()) {
    return {
      ok: false,
      path: relPath,
      error: "BrowserNoFs",
      hint: "当前运行在浏览器环境，无法直接读取物理文件。请通过服务端 API 或让用户提供日志内容。",
    }
  }

  const pathMod = await import("node:path")
  const fs = await import("node:fs")
  const root = process.cwd()
  const abs = pathMod.join(root, p)

  try {
    if (!fs.existsSync(abs)) {
      if (isLogLikePath(p)) {
        return { ok: false, path: p, error: "NotFound", hint: "日志文件尚未生成，请参考内存中的原始错误对象。" }
      }
      return { ok: false, path: p, error: "NotFound" }
    }

    if (isLayoutAwareBinaryPath(p)) {
      const buffer = await readFileBuffer(abs)
      const parsed = await parseLayoutAwareDocument({ buffer, filename: pathMod.basename(p) })
      return {
        ok: true,
        path: p,
        text: parsed.text,
        layout: parsed.layout,
        parser: parsed.parser,
        chunks: parsed.chunks,
        ragContext: parsed.ragContext,
      }
    }

    const text = fs.readFileSync(abs, "utf8")
    return { ok: true, path: p, text }
  } catch (e) {
    if (isErrnoLike(e, "ENOENT") && isLogLikePath(p)) {
      return { ok: false, path: p, error: "NotFound", hint: "日志文件尚未生成，请参考内存中的原始错误对象。" }
    }
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, path: p, error: msg }
  }
}

