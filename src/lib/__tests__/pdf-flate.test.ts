import { deflateSync } from "node:zlib"

import { describe, expect, it } from "vitest"

import {
  extractPdfLayoutBlocks,
  extractPdfPageGeometries,
} from "../document/pdf-text-extract"

/**
 * 真实 PDF 的内容流几乎都是 FlateDecode 压缩的（LaTeX / Word / Acrobat 默认如此）。
 *
 * 原实现把 `stream ... endstream` 之间的字节直接当 latin1 文本 token 化 ——
 * 压缩流里没有 `BT` / `Tj` / `Tm`，于是一个块都提不出来，只能落到
 * `extractPdfPlainText` 兜底：在全文件里抓 `(...)` 与 `<hex>`，
 * 抓到的全是压缩字节里偶然出现的括号串，输出是乱码而不是正文。
 *
 * 也就是「上传一份正常 PDF → 检索/审稿拿到乱码」。
 */

function buildPdfWithStream(contentStream: Buffer, opts: { filter?: boolean; mediaBox?: string } = {}) {
  const filter = opts.filter === false ? "" : " /Filter /FlateDecode"
  const head = Buffer.from(
    `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox ${opts.mediaBox ?? "[0 0 612 792]"} /Contents 4 0 R >>
endobj
4 0 obj
<< /Length ${contentStream.length}${filter} >>
stream
`,
    "latin1"
  )
  const tail = Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1")
  return Buffer.concat([head, contentStream, tail])
}

function flate(content: string): Buffer {
  return deflateSync(Buffer.from(content, "latin1"))
}

describe("PDF 压缩内容流（FlateDecode）", () => {
  it("压缩流里的文本能被提取", () => {
    const pdf = buildPdfWithStream(flate("BT /F1 12 Tf 72 720 Td (Hello compressed world) Tj ET"))
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.text).toContain("Hello compressed world")
    expect(out.blocks).toHaveLength(1)
    expect(out.blocks[0]!.x).toBe(72)
    expect(out.blocks[0]!.y).toBe(720)
    expect(out.blocks[0]!.page).toBe(1)
  })

  it("压缩流里的 TJ 数组仍被拼接（字偶距不插空格）", () => {
    const pdf = buildPdfWithStream(flate("BT 60 640 Td [(Compressed) -20 (Glyphs)] TJ ET"))
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.text).toContain("CompressedGlyphs")
  })

  it("压缩流里的 TJ 词间位移还原成空格", () => {
    // -300 = 0.3em，是生成器代替空格的分词位移
    const pdf = buildPdfWithStream(flate("BT 60 640 Td [(Compressed) -300 (Glyphs)] TJ ET"))
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.text).toContain("Compressed Glyphs")
  })

  it("压缩流里不会混进乱码兜底", () => {
    const pdf = buildPdfWithStream(flate("BT 72 700 Td (Clean text only) Tj ET"))
    const out = extractPdfLayoutBlocks(pdf)
    // 兜底路径会把二进制里的括号串抓出来；走上主路径后 blocks 非空、文本干净
    expect(out.blocks.length).toBeGreaterThan(0)
    expect(out.text).toBe("Clean text only")
  })

  it("MediaBox 不受压缩影响", () => {
    const pdf = buildPdfWithStream(flate("BT 10 700 Td (x) Tj ET"), { mediaBox: "[0 0 595 842]" })
    const geo = extractPdfPageGeometries(pdf)
    expect(geo).toHaveLength(1)
    expect(geo[0]!.width).toBe(595)
    expect(geo[0]!.height).toBe(842)
  })

  it("损坏的压缩流不抛异常", () => {
    const broken = Buffer.from([0x78, 0x9c, 0x00, 0x11, 0x22, 0x33, 0x44])
    const pdf = buildPdfWithStream(broken)
    expect(() => extractPdfLayoutBlocks(pdf)).not.toThrow()
  })
})

describe("PDF 未压缩流（回归）", () => {
  it("没有 /Filter 时按原文解析", () => {
    const pdf = buildPdfWithStream(Buffer.from("BT 50 700 Td (Plain stream body) Tj ET", "latin1"), {
      filter: false,
    })
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.text).toContain("Plain stream body")
  })
})
