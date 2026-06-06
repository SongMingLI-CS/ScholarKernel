import type { LayoutTextBlock } from "@/lib/document/column-reorder"

type PdfExtractResult = {
  text: string
  blocks: LayoutTextBlock[]
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

/** 从 PDF content stream 片段提取带坐标的文本块（Tm/Td/Tj/TJ）。 */
export function extractPdfLayoutBlocks(buffer: Buffer): PdfExtractResult {
  const raw = buffer.toString("latin1")
  const blocks: LayoutTextBlock[] = []

  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let page = 0

  const flushText = (text: string, x: number, y: number) => {
    const t = text.replace(/\s+/g, " ").trim()
    if (t.length < 2) return
    blocks.push({ text: t, x, y, page })
  }

  let match: RegExpExecArray | null
  while ((match = streamRe.exec(raw)) !== null) {
    page += 1
    const stream = match[1] ?? ""
    let x = 0
    let y = 0
    let pending = ""

    const tokens = stream.match(/[^\s]+|\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g) ?? []
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!
      if (tok === "Tm" && i >= 6) {
        const ty = parseFloat(tokens[i - 1]!)
        const tx = parseFloat(tokens[i - 4]!)
        if (!Number.isNaN(tx)) x = tx
        if (!Number.isNaN(ty)) y = ty
        i -= 6
        continue
      }
      if (tok === "Td" && i >= 2) {
        const dy = parseFloat(tokens[i - 1]!)
        const dx = parseFloat(tokens[i - 2]!)
        if (!Number.isNaN(dx)) x += dx
        if (!Number.isNaN(dy)) y += dy
        i -= 2
        continue
      }
      if (tok === "Tj" && i >= 1) {
        const prev = tokens[i - 1]!
        if (prev.startsWith("(")) pending += decodePdfLiteral(prev.slice(1, -1))
        else if (prev.startsWith("<")) pending += decodePdfHex(prev.slice(1, -1))
        i -= 1
        continue
      }
      if (tok === "TJ" && i >= 1) {
        const arr = tokens[i - 1] ?? ""
        const parts = arr.match(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g) ?? []
        for (const p of parts) {
          if (p.startsWith("(")) pending += decodePdfLiteral(p.slice(1, -1))
          else if (p.startsWith("<")) pending += decodePdfHex(p.slice(1, -1))
        }
        i -= 1
        continue
      }
      if (tok === "T*" || tok === "ET" || tok === "Q") {
        if (pending.trim()) flushText(pending, x, y)
        pending = ""
      }
    }
    if (pending.trim()) flushText(pending, x, y)
  }

  if (blocks.length === 0) {
    const fallback = extractPdfPlainText(raw)
    return { text: fallback, blocks: [] }
  }

  const sorted = [...blocks].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  return { text: sorted.map((b) => b.text).join("\n"), blocks }
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
