import {
  formatAcademicChunksForContext,
  semanticChunkAcademicText,
  type AcademicChunk,
} from "@/lib/document/academic-semantic-chunker"
import { applyColumnReorder, type LayoutTextBlock, type PageGeometry } from "@/lib/document/column-reorder"
import { normalizeAcademicFormulas } from "@/lib/document/formula-normalizer"
import { extractDocxFromBuffer } from "@/lib/document/docx-text-extract"
import { extractPdfFromBuffer } from "@/lib/document/pdf-text-extract"

export type LayoutParseFormat = "pdf" | "docx" | "text" | "unknown"

export type LayoutParseResult = {
  text: string
  format: LayoutParseFormat
  layout: "single" | "double" | "unknown"
  parser: "local" | "external"
  blocks: number
  warnings: string[]
  chunks: AcademicChunk[]
  ragContext: string
}

export type ExternalLayoutParserRequest = {
  buffer: Buffer
  filename: string
  mimeType?: string
}

export type ExternalLayoutParser = (
  req: ExternalLayoutParserRequest
) => Promise<{ text: string; blocks?: LayoutTextBlock[] } | null>

let externalParserHook: ExternalLayoutParser | null = null

/** 生产环境可注入 Marker / MinerU 等外部版面解析器。 */
export function setExternalLayoutParser(parser: ExternalLayoutParser | null) {
  externalParserHook = parser
}

function safeEnv(name: string): string {
  try {
    const v = (process.env as Record<string, string | undefined> | undefined)?.[name]
    return typeof v === "string" ? v.trim() : ""
  } catch {
    return ""
  }
}

const DEFAULT_LAYOUT_PARSER_TIMEOUT_MS = 15_000

function layoutParserTimeoutMs(): number {
  const raw = Number.parseInt(safeEnv("LAYOUT_PARSER_TIMEOUT_MS"), 10)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LAYOUT_PARSER_TIMEOUT_MS
}

/** 给不可取消的外部调用套一层时限；至少保证调用方不会一起挂住。 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}:timeout`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/**
 * 外部版面解析器是**可选增强层**：任何失败（抛错 / 超时 / 非 JSON / 非 2xx）
 * 都必须降级到本地解析，而不是把整次文档摄取一起弄失败。
 */
async function callExternalLayoutParser(
  buffer: Buffer,
  filename: string,
  mimeType: string | undefined,
  warnings: string[]
): Promise<{ text: string; blocks?: LayoutTextBlock[] } | null> {
  const hook = externalParserHook
  const url = safeEnv("LAYOUT_PARSER_URL")
  if (!hook && !url) return null

  const timeoutMs = layoutParserTimeoutMs()

  try {
    if (hook) {
      // 同步抛错与永不 resolve 都要处理：前者由 Promise.resolve 捕获，
      // 后者由 withTimeout 兜住。
      return await withTimeout(
        Promise.resolve(hook({ buffer, filename, mimeType })),
        timeoutMs,
        "ExternalParser"
      )
    }

    const apiKey = safeEnv("LAYOUT_PARSER_API_KEY")
    const headers: Record<string, string> = {}
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

    const signal = AbortSignal.timeout(timeoutMs)

    let res: Response
    try {
      const body = new FormData()
      body.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename)
      res = await fetch(url, { method: "POST", headers, body, signal })
    } catch (firstError) {
      // 服务端不接受 multipart 时退回 base64 JSON；但若已经超时/取消，不再重试
      if (signal.aborted) throw firstError
      res = await fetch(url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          filename,
          mimeType,
          content_base64: buffer.toString("base64"),
        }),
        signal,
      })
    }
    if (!res.ok) {
      warnings.push(`ExternalParserHttp:${res.status}`)
      return null
    }

    const data = (await res.json()) as {
      text?: string
      markdown?: string
      blocks?: LayoutTextBlock[]
    }
    const text = (data.text ?? data.markdown ?? "").trim()
    if (!text) return null
    return { text, blocks: data.blocks }
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}:${e.message}` : String(e)
    console.warn(`[layout-parser] external parser failed, falling back to local (${msg})`)
    warnings.push(`ExternalParserUnavailable:${msg}`)
    return null
  }
}

function detectFormat(filename: string, mimeType?: string): LayoutParseFormat {
  const lower = filename.toLowerCase()
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf"
  if (lower.endsWith(".docx") || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return "docx"
  if (/\.(txt|md|tex|bib)$/i.test(lower)) return "text"
  return "unknown"
}

function cleanAcademicNoise(text: string): string {
  return text
    .replace(/\f/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

function finalizeParseResult(input: {
  text: string
  format: LayoutParseFormat
  layout: "single" | "double" | "unknown"
  parser: "local" | "external"
  blocks: number
  warnings: string[]
  layoutBlocks?: LayoutTextBlock[]
  pageGeometries?: PageGeometry[]
}): LayoutParseResult {
  const chunks = semanticChunkAcademicText({
    text: input.text,
    blocks: input.layoutBlocks,
    pageGeometries: input.pageGeometries,
  })
  return {
    text: input.text,
    format: input.format,
    layout: input.layout,
    parser: input.parser,
    blocks: input.blocks,
    warnings: input.warnings,
    chunks,
    ragContext: formatAcademicChunksForContext(chunks),
  }
}

export async function parseLayoutAwareDocument(input: {
  buffer: Buffer
  filename: string
  mimeType?: string
}): Promise<LayoutParseResult> {
  const warnings: string[] = []
  const format = detectFormat(input.filename, input.mimeType)

  const external = await callExternalLayoutParser(input.buffer, input.filename, input.mimeType, warnings)
  if (external?.text) {
    // 外部解析器已产出最终阅读顺序：只在有坐标块时按栏重排，禁止纯文本启发式再次改写。
    const reordered = applyColumnReorder(external.text, external.blocks)
    const normalized = normalizeAcademicFormulas(cleanAcademicNoise(reordered.text))
    return finalizeParseResult({
      text: normalized,
      format,
      layout: reordered.layout,
      parser: "external",
      blocks: reordered.blocks,
      warnings,
      layoutBlocks: external.blocks,
    })
  }

  let rawText = ""
  let blocks: LayoutTextBlock[] = []
  let pageGeometries: PageGeometry[] = []

  if (format === "pdf") {
    const pdf = extractPdfFromBuffer(input.buffer)
    rawText = pdf.text
    blocks = pdf.blocks
    pageGeometries = pdf.pageGeometries
    if (!rawText.trim()) warnings.push("PdfExtractEmpty")
  } else if (format === "docx") {
    try {
      rawText = extractDocxFromBuffer(input.buffer)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      warnings.push(`DocxExtractFailed:${msg}`)
      rawText = ""
    }
  } else if (format === "text") {
    rawText = input.buffer.toString("utf8")
  } else {
    rawText = input.buffer.toString("utf8")
    warnings.push("UnknownFormatFallbackUtf8")
  }

  const reordered = applyColumnReorder(
    rawText,
    blocks.length ? blocks : undefined,
    pageGeometries.length ? pageGeometries : undefined,
    // 仅 PDF（且显式开启）才允许纯文本奇偶行重排；docx / md / txt 一律保持原序。
    { plainTextHeuristic: format === "pdf" && safeEnv("DOC_COLUMN_REORDER_PLAINTEXT") === "1" }
  )
  const normalized = normalizeAcademicFormulas(cleanAcademicNoise(reordered.text))

  return finalizeParseResult({
    text: normalized,
    format,
    layout: reordered.layout,
    parser: "local",
    blocks: reordered.blocks,
    warnings,
    layoutBlocks: blocks.length ? blocks : undefined,
    pageGeometries: pageGeometries.length ? pageGeometries : undefined,
  })
}

export function isLayoutAwareBinaryPath(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith(".pdf") || lower.endsWith(".docx")
}
