import { inflateRawSync } from "node:zlib"

/**
 * 轻量 DOCX 解压：仅解析 word/document.xml，不引入额外依赖。
 * DOCX = ZIP(LOCAL FILE HEADER) 容器。
 */
function findZipEntry(data: Buffer, entryName: string): Buffer | null {
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
      if (compMethod === 0) return payload.subarray(0, uncompSize)
      if (compMethod === 8) return inflateRawSync(payload)
      return null
    }

    offset = dataStart + compSize
  }
  return null
}

function xmlTextContent(xml: string): string {
  const paras: string[] = []
  const pRe = /<w:p[\s>][\s\S]*?<\/w:p>/g
  let pm: RegExpExecArray | null
  while ((pm = pRe.exec(xml)) !== null) {
    const p = pm[0]
    const texts: string[] = []
    const tRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
    let tm: RegExpExecArray | null
    while ((tm = tRe.exec(p)) !== null) {
      texts.push(
        tm[1]!
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
      )
    }
    const line = texts.join("").trim()
    if (line) paras.push(line)
  }
  return paras.join("\n")
}

export function extractDocxFromBuffer(buffer: Buffer): string {
  const entry = findZipEntry(buffer, "word/document.xml")
  if (!entry) throw new Error("DocxMissingDocumentXml")
  const xml = entry.toString("utf8")
  return xmlTextContent(xml)
}
