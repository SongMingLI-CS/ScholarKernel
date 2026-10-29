import path from "node:path"

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import type { PDFDocumentLoadingTask, PDFPageProxy } from "pdfjs-dist"

import type { LayoutTextBlock, PageGeometry } from "@/lib/document/column-reorder"

export const MAX_PDF_BYTES = 8 * 1024 * 1024
export const PDF_PARSE_TIMEOUT_MS = 15_000

const PDFJS_DATA_DIRECTORY = path.join(process.cwd(), "node_modules", "pdfjs-dist")
const PDFJS_CMAP_DIRECTORY = `${path.join(PDFJS_DATA_DIRECTORY, "cmaps")}${path.sep}`
const PDFJS_STANDARD_FONTS_DIRECTORY = `${path.join(PDFJS_DATA_DIRECTORY, "standard_fonts")}${path.sep}`

export type PdfParseErrorCode =
  | "PDF_TOO_LARGE"
  | "PDF_TIMEOUT"
  | "PDF_PASSWORD_PROTECTED"
  | "PDF_INVALID"
  | "PDF_UNSUPPORTED"
  | "PDF_NO_TEXT"

const PDF_PARSE_MESSAGES: Record<PdfParseErrorCode, string> = {
  PDF_TOO_LARGE: "PDF 文件超过 8 MiB 限制，请压缩或拆分后重试。",
  PDF_TIMEOUT: "PDF 解析超过 15 秒。请压缩或拆分文档后重试。",
  PDF_PASSWORD_PROTECTED: "该 PDF 受密码保护或已加密，请上传解除密码保护的副本。",
  PDF_INVALID: "无法读取该 PDF，文件可能已损坏或不是有效的 PDF。请重新导出后重试。",
  PDF_UNSUPPORTED: "当前 PDF 的压缩方式或字体编码暂不支持。请另存为标准 PDF，或导出为可复制文本的 PDF。",
  PDF_NO_TEXT: "未能从该 PDF 提取可复制文本。文件可能是空白页或扫描图片，请先进行 OCR 后再上传。",
}

export class PdfParseError extends Error {
  constructor(
    readonly code: PdfParseErrorCode,
    readonly status: number = code === "PDF_TOO_LARGE" ? 413 : code === "PDF_TIMEOUT" ? 408 : 422
  ) {
    super(PDF_PARSE_MESSAGES[code])
    this.name = "PdfParseError"
  }
}

export type PdfExtractResult = {
  text: string
  blocks: LayoutTextBlock[]
  pageGeometries: PageGeometry[]
}

type PositionedText = {
  text: string
  x: number
  y: number
  width: number
  height: number
  hasEOL: boolean
}

function toPdfParseError(error: unknown): PdfParseError {
  if (error instanceof PdfParseError) return error

  const name =
    typeof error === "object" && error !== null && "name" in error ? String(error.name) : ""
  if (name === "PasswordException") return new PdfParseError("PDF_PASSWORD_PROTECTED")
  if (["InvalidPDFException", "MissingPDFException", "FormatError"].includes(name)) {
    return new PdfParseError("PDF_INVALID")
  }
  return new PdfParseError("PDF_UNSUPPORTED")
}

function appendText(previous: PositionedText, next: PositionedText): void {
  const previousEnd = previous.x + previous.width
  const gap = next.x - previousEnd
  const needsSpace =
    !previous.text.endsWith(" ") &&
    !next.text.startsWith(" ") &&
    gap > Math.max(0.5, Math.min(3, next.height * 0.15))

  previous.text += `${needsSpace ? " " : ""}${next.text}`
  previous.width = Math.max(previous.width, next.x + next.width - previous.x)
  previous.hasEOL = next.hasEOL
}

function createPageBlocks(
  page: PDFPageProxy,
  pageNumber: number
): Promise<{ blocks: LayoutTextBlock[]; geometry: PageGeometry }> {
  const viewport = page.getViewport({ scale: 1 })
  const view = page.view
  const viewX = view[0] ?? 0
  const geometry: PageGeometry = {
    page: pageNumber,
    width: Math.abs((view[2] ?? viewport.width) - viewX),
    height: Math.abs((view[3] ?? viewport.height) - (view[1] ?? 0)),
  }

  return page.getTextContent().then((content) => {
    const items: PositionedText[] = []
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue
      const x = Number(item.transform[4]) - viewX
      const y = Number(item.transform[5])
      const width = Number(item.width)
      const height = Number(item.height)
      if (![x, y, width, height].every(Number.isFinite)) continue
      items.push({ text: item.str, x, y, width, height, hasEOL: item.hasEOL })
    }

    items.sort((a, b) => b.y - a.y || a.x - b.x)

    const lineItems: PositionedText[] = []
    const midline = geometry.width / 2
    for (const item of items) {
      const previous = lineItems[lineItems.length - 1]
      const sameColumn = previous && (previous.x < midline) === (item.x < midline)
      const lineTolerance = Math.max(1.5, Math.min(4, item.height * 0.25))
      if (
        previous &&
        sameColumn &&
        !previous.hasEOL &&
        Math.abs(previous.y - item.y) <= lineTolerance
      ) {
        appendText(previous, item)
      } else {
        lineItems.push({ ...item })
      }
    }

    const blocks = lineItems
      .map((item) => ({ text: item.text, x: item.x, y: item.y, page: pageNumber, width: item.width }))
      .filter((block) => block.text.trim().length > 0)

    return { blocks, geometry }
  })
}

async function destroyLoadingTask(task: PDFDocumentLoadingTask): Promise<void> {
  try {
    await task.destroy()
  } catch {
    // The worker may already have been destroyed when a parse timed out.
  }
}

export async function extractPdfFromBuffer(
  buffer: Buffer,
  options: { timeoutMs?: number } = {}
): Promise<PdfExtractResult> {
  if (buffer.length > MAX_PDF_BYTES) throw new PdfParseError("PDF_TOO_LARGE")

  const timeoutMs = options.timeoutMs ?? PDF_PARSE_TIMEOUT_MS
  const task = getDocument({
    data: new Uint8Array(buffer),
    cMapUrl: PDFJS_CMAP_DIRECTORY,
    cMapPacked: true,
    standardFontDataUrl: PDFJS_STANDARD_FONTS_DIRECTORY,
    useSystemFonts: true,
  })
  let destroyPromise: Promise<void> | undefined
  const destroy = () => (destroyPromise ??= destroyLoadingTask(task))
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    const parse = async () => {
      const document = await task.promise
      const blocks: LayoutTextBlock[] = []
      const pageGeometries: PageGeometry[] = []

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber)
        try {
          const result = await createPageBlocks(page, pageNumber)
          blocks.push(...result.blocks)
          pageGeometries.push(result.geometry)
        } finally {
          page.cleanup()
        }
      }

      return {
        text: blocks.map((block) => block.text).join("\n"),
        blocks,
        pageGeometries,
      }
    }

    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        void destroy()
        reject(new PdfParseError("PDF_TIMEOUT"))
      }, Math.max(1, timeoutMs))
    })

    return await Promise.race([parse(), timedOut])
  } catch (error) {
    throw toPdfParseError(error)
  } finally {
    if (timeout) clearTimeout(timeout)
    await destroy()
  }
}
