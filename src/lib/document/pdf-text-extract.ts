import type { LayoutTextBlock, PageGeometry } from "@/lib/document/column-reorder"
import { inflateSync } from "node:zlib"

type PdfExtractResult = {
  text: string
  blocks: LayoutTextBlock[]
  pageGeometries: PageGeometry[]
}

function decodePdfLiteral(s: string): string {
  return s
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
}

function decodePdfHex(hex: string): string {
  const clean = hex.replace(/\s+/g, "")
  if (!clean) return ""
  let out = ""
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16)
    if (!Number.isNaN(byte)) out += String.fromCharCode(byte)
  }
  return out
}

/** 从 PDF 对象树提取各页 MediaBox 宽度（用于双栏中轴线判定）。 */
export function extractPdfPageGeometries(buffer: Buffer): PageGeometry[] {
  const raw = buffer.toString("latin1")
  const geometries: PageGeometry[] = []
  const mediaRe = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g
  let page = 0
  let m: RegExpExecArray | null
  while ((m = mediaRe.exec(raw)) !== null) {
    page += 1
    const x0 = parseFloat(m[1]!)
    const y0 = parseFloat(m[2]!)
    const x1 = parseFloat(m[3]!)
    const y1 = parseFloat(m[4]!)
    if ([x0, y0, x1, y1].some((v) => Number.isNaN(v))) continue
    geometries.push({
      page,
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0),
    })
  }
  return geometries
}

/** 从 PDF content stream 片段提取带坐标的文本块（Tm/Td/Tj/TJ）。 */
export function extractPdfLayoutBlocks(buffer: Buffer): PdfExtractResult {
  const raw = buffer.toString("latin1")
  const blocks: LayoutTextBlock[] = []
  const objects = new Map<number, string>()
  const objectOrder: Array<{ id: number; body: string }> = []
  const objectRe = /(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g
  let objectMatch: RegExpExecArray | null
  while ((objectMatch = objectRe.exec(raw)) !== null) {
    const id = Number(objectMatch[1])
    const body = objectMatch[2] ?? ""
    objects.set(id, body)
    objectOrder.push({ id, body })
  }

  const pageObjects = objectOrder.filter(({ body }) => /\/Type\s*\/Page(?!s)\b/.test(body))
  const pageTextStreams: string[] = []
  const pageGeometries: PageGeometry[] = pageObjects.flatMap(({ body }, index) => {
    const match = body.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/)
    if (!match) return []
    const values = match.slice(1, 5).map(Number)
    if (values.some(Number.isNaN)) return []
    return [{ page: index + 1, width: Math.abs(values[2]! - values[0]!), height: Math.abs(values[3]! - values[1]!) }]
  })

  const flushText = (text: string, x: number, y: number, page: number) => {
    const t = text.replace(/\s+/g, " ").trim()
    if (t.length < 2) return
    blocks.push({ text: t, x, y, page })
  }

  const extractTextStream = (stream: string, page: number) => {
    // Images, attachments, font programs and other binary streams can dwarf the
    // actual page content. Do not tokenize them as text.
    if (!/\b(?:BT|Tj|TJ)\b/.test(stream)) return
    let x = 0
    let y = 0
    let pending = ""

    const tokens = stream.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>|[^\s]+/g) ?? []
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!
      if (tok === "Tm" && i >= 6) {
        const ty = parseFloat(tokens[i - 1]!)
        const tx = parseFloat(tokens[i - 4]!)
        if (!Number.isNaN(tx)) x = tx
        if (!Number.isNaN(ty)) y = ty
        continue
      }
      if (tok === "Td" && i >= 2) {
        const dy = parseFloat(tokens[i - 1]!)
        const dx = parseFloat(tokens[i - 2]!)
        if (!Number.isNaN(dx)) x += dx
        if (!Number.isNaN(dy)) y += dy
        continue
      }
      if (tok === "Tj" && i >= 1) {
        const prev = tokens[i - 1]!
        if (prev.startsWith("(")) pending += decodePdfLiteral(prev.slice(1, -1))
        else if (prev.startsWith("<")) pending += decodePdfHex(prev.slice(1, -1))
        continue
      }
      if (tok === "TJ" && i >= 1) {
        const arr = tokens[i - 1] ?? ""
        const parts = arr.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g) ?? []
        for (const p of parts) {
          if (p.startsWith("(")) pending += decodePdfLiteral(p.slice(1, -1))
          else if (p.startsWith("<")) pending += decodePdfHex(p.slice(1, -1))
        }
        continue
      }
      if (tok === "T*" || tok === "ET" || tok === "Q") {
        if (pending.trim()) flushText(pending, x, y, page)
        pending = ""
      }
    }
    if (pending.trim()) flushText(pending, x, y, page)
  }

  const decodeObjectStream = (body: string): string | null => {
    const stream = body.match(/stream(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)endstream/)?.[1]
    if (stream === undefined) return null
    if (!/\/Filter\s*(?:\/FlateDecode|\/Fl\b|\[[^\]]*\/(?:FlateDecode|Fl)\b)/.test(body)) return stream
    try {
      return inflateSync(Buffer.from(stream, "latin1")).toString("latin1")
    } catch {
      return null
    }
  }

  let usedPageTree = false
  for (let pageIndex = 0; pageIndex < pageObjects.length; pageIndex += 1) {
    const pageBody = pageObjects[pageIndex]!.body
    const contents = pageBody.match(/\/Contents\s*(\[[^\]]+\]|\d+\s+\d+\s+R)/)?.[1]
    if (!contents) continue
    const refs = [...contents.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]))
    for (const ref of refs) {
      const body = objects.get(ref)
      const stream = body ? decodeObjectStream(body) : null
      if (stream === null) continue
      usedPageTree = true
      pageTextStreams.push(stream)
      extractTextStream(stream, pageIndex + 1)
    }
  }

  // Some minimal or malformed PDFs omit a usable page tree. Preserve a bounded
  // fallback, but still reject streams without PDF text operators.
  if (!usedPageTree) {
    const streamRe = /stream(?:\r\n|\n|\r)([\s\S]*?)(?:\r\n|\n|\r)endstream/g
    let page = 0
    let match: RegExpExecArray | null
    while ((match = streamRe.exec(raw)) !== null) {
      const stream = match[1] ?? ""
      if (!/\b(?:BT|Tj|TJ)\b/.test(stream)) continue
      page += 1
      extractTextStream(stream, page)
    }
  }

  if (blocks.length === 0) {
    const fallback = extractPdfPlainText(usedPageTree ? pageTextStreams.join("\n") : raw)
    return { text: fallback, blocks: [], pageGeometries: pageGeometries.length ? pageGeometries : extractPdfPageGeometries(buffer) }
  }

  // 不在此处做 naive 排序拼接；交由 column-reorder 按双栏阅读顺序重组。
  return {
    text: blocks.map((b) => b.text).join("\n"),
    blocks,
    pageGeometries: pageGeometries.length ? pageGeometries : extractPdfPageGeometries(buffer),
  }
}

/** 无坐标时的纯文本兜底：抓取 (..) 与 <hex> 字串。 */
export function extractPdfPlainText(rawLatin1: string): string {
  const chunks: string[] = []
  const litRe = /\((?:\\.|[^\\)])*\)/g
  let m: RegExpExecArray | null
  while ((m = litRe.exec(rawLatin1)) !== null) {
    const decoded = decodePdfLiteral(m[0].slice(1, -1)).trim()
    if (decoded.length >= 2) chunks.push(decoded)
  }
  const hexRe = /<([0-9A-Fa-f\s]{4,})>/g
  while ((m = hexRe.exec(rawLatin1)) !== null) {
    const decoded = decodePdfHex(m[1] ?? "").trim()
    if (decoded.length >= 2) chunks.push(decoded)
  }
  return chunks.join("\n")
}

export function extractPdfFromBuffer(buffer: Buffer): PdfExtractResult {
  return extractPdfLayoutBlocks(buffer)
}
