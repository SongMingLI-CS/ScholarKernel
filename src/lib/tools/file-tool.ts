import { tool, zodSchema } from "ai"
import { z } from "zod"

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
  | { ok: true; path: string; text: string; layout?: string; parser?: string }
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

export function createFileTool() {
  return tool({
    description:
      "读取项目根目录下的本地文件（相对路径）。支持 .pdf/.docx 版面感知解析（双栏阅读顺序 + LaTeX 公式重构）。" +
      "必须提供 input.path（必填）。仅用于 src/、package.json 等本地源码/配置或用户上传的论文附件；严禁用于在线文献 URL。",
    inputSchema: zodSchema(
      z.object({
        path: z
          .string()
          .min(1)
          .describe(
            '必填。相对项目根目录的文件路径，例如 "src/app/page.tsx"、"papers/sample.pdf" 或 "logs/error.log"。'
          ),
        maxChars: z.number().int().min(1).max(200_000).optional().default(80_000),
      })
    ),
    execute: async ({ path, maxChars }) => {
      if (typeof path !== "string" || !path.trim()) {
        return {
          ok: false as const,
          path: "",
          error: "Error: 请提供具体的文件路径",
          hint: '请提供 input.path，例如 "src/app/page.tsx"',
        }
      }
      const r = await safeReadTextFile(path)
      if (!r.ok) {
        return { ok: false as const, path: r.path, error: r.error, hint: r.hint }
      }
      const text = r.text.length > maxChars ? r.text.slice(0, maxChars) + "\n\n[...truncated...]" : r.text
      return {
        ok: true as const,
        path: r.path,
        chars: r.text.length,
        text,
        ...(r.layout ? { layout: r.layout } : {}),
        ...(r.parser ? { parser: r.parser } : {}),
      }
    },
  })
}
