import { inflateRawSync } from "node:zlib"

/**
 * 解压后 XML 的体积上限。
 * 上传限制（8MiB）约束的是**压缩后**体积，而 deflate 的极限压缩比约 1000:1，
 * 一个几 MB 的 docx 可以把解压结果放大到数 GB。这里给解压结果兜一个上限。
 */
const DEFAULT_MAX_DOCX_XML_BYTES = 32 * 1024 * 1024

function maxDocxXmlBytes(): number {
  try {
    const raw = (process.env as Record<string, string | undefined>)?.["DOCX_MAX_XML_BYTES"]
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_DOCX_XML_BYTES
  } catch {
    return DEFAULT_MAX_DOCX_XML_BYTES
  }
}

/**
 * 轻量 DOCX 解压：仅解析 word/document.xml，不引入额外依赖。
 * DOCX = ZIP(LOCAL FILE HEADER) 容器。
 */
function findZipEntry(data: Buffer, entryName: string, maxBytes: number): Buffer | null {
  let offset = 0
  while (offset + 30 < data.length) {
    const sig = data.readUInt32LE(offset)
    if (sig !== 0x04034b50) break

    const compMethod = data.readUInt16LE(offset + 8)
    const compSize = data.readUInt32LE(offset + 18)
    const uncompSize = data.readUInt32LE(offset + 22)
    const nameLen = data.readUInt16LE(offset + 26)
    const extraLen = data.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const name = data.toString("utf8", nameStart, nameStart + nameLen)
    const dataStart = nameStart + nameLen + extraLen
    const payload = data.subarray(dataStart, dataStart + compSize)

    if (name === entryName) {
      if (uncompSize > maxBytes) throw new Error(`DocxTooLarge:${uncompSize}`)
      if (compMethod === 0) return payload.subarray(0, uncompSize)
      if (compMethod === 8) {
        try {
          // 头部声明的 uncompSize 可以撒谎，maxOutputLength 才是真正的兜底
          return inflateRawSync(payload, { maxOutputLength: maxBytes })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          throw new Error(`DocxTooLarge:${msg}`)
        }
      }
      return null
    }

    offset = dataStart + compSize
  }
  return null
}

function codePointToString(codePoint: number): string {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return ""
  try {
    return String.fromCodePoint(codePoint)
  } catch {
    return ""
  }
}

/** XML 实体解码。`&amp;` 必须最后处理，否则 `&amp;lt;` 会被二次解码成 `<`。 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePointToString(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => codePointToString(Number.parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
}

/**
 * 段落内的行内元素。
 * 注意 `<w:t(?:\s[^>]*)?>` 不能写成 `<w:t[^>]*>`：
 * 后者会把 `<w:tab/>`、`<w:tc>` 也当成文本节点起点，捕获出 `<w:t>Value` 这种垃圾。
 */
const INLINE_SOURCE = String.raw`<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>`
const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g

function xmlTextContent(xml: string): string {
  const paras: string[] = []
  let pm: RegExpExecArray | null
  const pRe = new RegExp(PARAGRAPH_RE.source, "g")
  while ((pm = pRe.exec(xml)) !== null) {
    const paragraph = pm[0]
    const parts: string[] = []
    const inlineRe = new RegExp(INLINE_SOURCE, "g")
    let im: RegExpExecArray | null
    while ((im = inlineRe.exec(paragraph)) !== null) {
      if (im[1] !== undefined) parts.push(decodeXmlEntities(im[1]))
      else if (im[0].startsWith("<w:tab")) parts.push("\t")
      else parts.push("\n")
    }
    const line = parts.join("").trim()
    if (line) paras.push(line)
  }
  return paras.join("\n")
}

export function extractDocxFromBuffer(buffer: Buffer): string {
  const entry = findZipEntry(buffer, "word/document.xml", maxDocxXmlBytes())
  if (!entry) throw new Error("DocxMissingDocumentXml")
  const xml = entry.toString("utf8")
  return xmlTextContent(xml)
}
