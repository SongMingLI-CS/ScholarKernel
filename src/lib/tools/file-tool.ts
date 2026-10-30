import { tool, zodSchema } from "ai"
import { z } from "zod"

export type FileReadResult =
  | { ok: true; path: string; text: string; layout?: string; parser?: string; chunks?: import("@/lib/document/academic-semantic-chunker").AcademicChunk[]; ragContext?: string }
  | { ok: false; path: string; error: string; hint?: string }

export type FileReader = (path: string) => Promise<FileReadResult>

const unavailableReader: FileReader = async path => ({
  ok: false, path, error: "BrowserNoFs",
  hint: "当前运行在浏览器环境，无法直接读取物理文件。请通过服务端 API 或让用户提供日志内容。",
})

export function createFileTool(readFile: FileReader = unavailableReader) {
  return tool({
    description:
      "读取当前用户已保存的学术文档，path 参数仅兼容承载文档 ID，不是本机路径。" +
      "文档必须通过当前用户的文档服务读取。系统源码、配置和日志不属于用户文档。",
    inputSchema: zodSchema(
      z.object({
        path: z
          .string()
          .min(1)
          .describe(
            '必填。当前用户已保存的文档 ID。'
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
      const r = await readFile(path)
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
        ...(r.chunks?.length ? { chunks: r.chunks, chunkCount: r.chunks.length } : {}),
        ...(r.ragContext ? { ragContext: r.ragContext } : {}),
      }
    },
  })
}
