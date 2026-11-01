import { describe, expect, it } from "vitest"

import { extractPdfLayoutBlocks, extractPdfPageGeometries } from "../document/pdf-text-extract"

/**
 * 手工构造的最小**未压缩** PDF。
 *
 * 真实 PDF 的内容流通常是 FlateDecode 压缩的，那条路径由 `pdf-flate.test.ts` 覆盖；
 * 这里固定未压缩路径的坐标与排版语义（Tm/Td/Tj/TJ、多内容流页码归属）。
 */
function buildPdf(opts: {
  pages: Array<{ mediaBox?: string; streams: string[] }>
}) {
  const parts: string[] = ["%PDF-1.7\n"]
  let objNum = 1
  const pageObjects: number[] = []
  const contentObjects: number[][] = []

  // 先占位页对象编号，再写内容对象，保持引用正确
  for (const page of opts.pages) {
    pageObjects.push(objNum++)
    contentObjects.push(page.streams.map(() => objNum++))
  }

  for (let p = 0; p < opts.pages.length; p++) {
    const page = opts.pages[p]!
    const refs = contentObjects[p]!.map((n) => `${n} 0 R`)
    const contents = refs.length === 1 ? refs[0] : `[${refs.join(" ")}]`
    const mediaBox = page.mediaBox ?? "[0 0 600 800]"
    parts.push(
      `${pageObjects[p]} 0 obj\n<< /Type /Page /MediaBox ${mediaBox} /Contents ${contents} >>\nendobj\n`
    )
  }

  for (let p = 0; p < opts.pages.length; p++) {
    const objs = contentObjects[p]!
    for (let s = 0; s < objs.length; s++) {
      const body = opts.pages[p]!.streams[s]!
      parts.push(`${objs[s]} 0 obj\n<< /Length ${body.length} >>\nstream\n${body}\nendstream\nendobj\n`)
    }
  }

  return Buffer.from(parts.join(""), "latin1")
}

describe("pdf layout block extraction", () => {
  it("extracts a single positioned text block", () => {
    const pdf = buildPdf({
      pages: [{ streams: ["BT /F1 12 Tf 50 700 Td (First page body) Tj ET"] }],
    })
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.blocks).toHaveLength(1)
    expect(out.blocks[0]!.text).toBe("First page body")
    expect(out.blocks[0]!.x).toBe(50)
    expect(out.blocks[0]!.y).toBe(700)
    expect(out.blocks[0]!.page).toBe(1)
  })

  it("concatenates TJ arrays into one block", () => {
    const pdf = buildPdf({
      pages: [{ streams: ["BT 60 640 Td [(Glyph) -20 (Graph)] TJ ET"] }],
    })
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.blocks).toHaveLength(1)
    // -20 = 0.02em 只是字偶距，不该变成空格
    expect(out.blocks[0]!.text).toBe("GlyphGraph")
  })

  it("TJ 词间位移（≤ -100）还原成空格", () => {
    // 生成器用 -250 ~ -350 的位移代替空格；不还原会让 "Hello World" 变成 "HelloWorld"
    const pdf = buildPdf({
      pages: [{ streams: ["BT 60 640 Td [(Hello) -250 (World)] TJ ET"] }],
    })
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.blocks[0]!.text).toBe("Hello World")
  })

  it("keeps blocks of one page on the same page number when the page has two content streams", () => {
    // PDF 允许 /Contents 是数组：一页可以由多个内容流组成。
    // 页码必须跟页对象走，而不是跟 stream 个数走。
    const pdf = buildPdf({
      pages: [
        {
          streams: [
            "BT 50 700 Td (Left column of page one) Tj ET",
            "BT 320 700 Td (Right column of page one) Tj ET",
          ],
        },
      ],
    })
    const geometries = extractPdfPageGeometries(pdf)
    expect(geometries).toHaveLength(1)

    const out = extractPdfLayoutBlocks(pdf)
    expect(out.blocks).toHaveLength(2)
    expect(out.blocks.map((b) => b.page)).toEqual([1, 1])
  })

  it("numbers pages by page object, not by stream order", () => {
    const pdf = buildPdf({
      pages: [
        { streams: ["BT 50 700 Td (Page one content) Tj ET", "BT 50 400 Td (Page one more) Tj ET"] },
        { streams: ["BT 50 700 Td (Page two content) Tj ET"] },
      ],
    })
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.blocks.map((b) => ({ page: b.page, text: b.text }))).toEqual([
      { page: 1, text: "Page one content" },
      { page: 1, text: "Page one more" },
      { page: 2, text: "Page two content" },
    ])
  })

  it("falls back to plain text when no positioned block is found", () => {
    const pdf = buildPdf({ pages: [{ streams: ["q 1 0 0 1 0 0 cm Q"] }] })
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.blocks).toHaveLength(0)
    expect(out.text.length).toBeGreaterThanOrEqual(0)
  })
})
