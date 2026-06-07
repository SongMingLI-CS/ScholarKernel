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

async function callExternalLayoutParser(
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<{ text: string; blocks?: LayoutTextBlock[] } | null> {
  if (externalParserHook) {
    return externalParserHook({ buffer, filename, mimeType })
  }

  const url = safeEnv("LAYOUT_PARSER_URL")
  const apiKey = safeEnv("LAYOUT_PARSER_API_KEY")
  if (!url) return null

  const headers: Record<string, string> = {}
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

  let res: Response
  try {
    const body = new FormData()
    body.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename)
    res = await fetch(url, { method: "POST", headers, body })
  } catch {
    res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        filename,
        mimeType,
        content_base64: buffer.toString("base64"),
      }),
    })
  }
  if (!res.ok) return null

  const data = (await res.json()) as {
    text?: string
    markdown?: string
    blocks?: LayoutTextBlock[]
  }
  const text = (data.text ?? data.markdown ?? "").trim()
  if (!text) return null
  return { text, blocks: data.blocks }
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

  const external = await callExternalLayoutParser(input.buffer, input.filename, input.mimeType)
  if (external?.text) {
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
    pageGeometries.length ? pageGeometries : undefined
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
