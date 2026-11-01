import { deflateRawSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { extractDocxFromBuffer } from "../document/docx-text-extract"

type ZipEntry = { name: string; content: Buffer; deflate?: boolean }

/** 构造最小 ZIP 容器（不写中央目录，解析器只读 local file header）。 */
function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const payload = entry.deflate ? deflateRawSync(entry.content) : entry.content
    const method = entry.deflate ? 8 : 0
    const nameBuf = Buffer.from(entry.name, "utf8")
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0, 6)
    header.writeUInt16LE(method, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt32LE(0, 14) // crc32：解析器不校验
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(entry.content.length, 22)
    header.writeUInt16LE(nameBuf.length, 26)
    header.writeUInt16LE(0, 28)
    chunks.push(header, nameBuf, payload)
  }
  return Buffer.concat(chunks)
}

function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
}

function docx(body: string, opts: { deflate?: boolean } = {}): Buffer {
  return buildZip([
    { name: "[Content_Types].xml", content: Buffer.from("<Types/>", "utf8") },
    { name: "word/document.xml", content: Buffer.from(documentXml(body), "utf8"), deflate: opts.deflate },
  ])
}

const ENV_KEY = "DOCX_MAX_XML_BYTES"

beforeEach(() => {
  delete process.env[ENV_KEY]
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

describe("docx 文本提取", () => {
  it("按段落提取文本", () => {
    const buf = docx("<w:p><w:r><w:t>First paragraph</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p>")
    expect(extractDocxFromBuffer(buf)).toBe("First paragraph\nSecond")
  })

  it("读取 deflate 压缩的 entry", () => {
    const buf = docx("<w:p><w:r><w:t>Compressed body</w:t></w:r></w:p>", { deflate: true })
    expect(extractDocxFromBuffer(buf)).toBe("Compressed body")
  })

  it("保留段落内的制表符", () => {
    // Word 的制表符是独立的 <w:tab/> 元素，不含 <w:t>，不处理就会静默丢字
    const buf = docx("<w:p><w:r><w:t>Name</w:t><w:tab/><w:t>Value</w:t></w:r></w:p>")
    expect(extractDocxFromBuffer(buf)).toBe("Name\tValue")
  })

  it("保留段落内的软换行", () => {
    const buf = docx("<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>Line two</w:t></w:r></w:p>")
    expect(extractDocxFromBuffer(buf)).toBe("Line one\nLine two")
  })

  it("解码 XML 实体（含 apos 与数值实体）", () => {
    const buf = docx(
      "<w:p><w:r><w:t>Tom &amp; Jerry&apos;s &lt;tag&gt; &#65;&#x42;</w:t></w:r></w:p>"
    )
    expect(extractDocxFromBuffer(buf)).toBe("Tom & Jerry's <tag> AB")
  })

  it("缺少 word/document.xml 时抛出明确错误", () => {
    const buf = buildZip([{ name: "other.xml", content: Buffer.from("<a/>", "utf8") }])
    expect(() => extractDocxFromBuffer(buf)).toThrow(/DocxMissingDocumentXml/)
  })

  it("解压结果超过上限时拒绝，而不是把内存吃光", () => {
    process.env[ENV_KEY] = "1024"
    const big = `<w:p><w:r><w:t>${"A".repeat(200_000)}</w:t></w:r></w:p>`
    const buf = docx(big, { deflate: true })
    expect(() => extractDocxFromBuffer(buf)).toThrow(/DocxTooLarge/)
  })
})
