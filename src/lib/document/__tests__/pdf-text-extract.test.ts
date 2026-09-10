import { describe, expect, it } from "vitest"
import { deflateSync } from "node:zlib"

import { extractPdfLayoutBlocks } from "@/lib/document/pdf-text-extract"

describe("extractPdfLayoutBlocks", () => {
  it("reads only page content streams and ignores large image or attachment streams", () => {
    const binaryPayload = "0".repeat(250_000)
    const pdf = Buffer.from([
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [4 0 R] /Count 1 >> endobj",
      `3 0 obj << /Type /XObject /Subtype /Image /Length ${binaryPayload.length} >> stream\n${binaryPayload}\nendstream endobj`,
      "4 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R >> endobj",
      "5 0 obj << /Length 58 >> stream\nBT /F1 11 Tf 54 730 Td (expected page text) Tj ET\nendstream endobj",
      "6 0 obj << /Type /EmbeddedFile /Length 22 >> stream\n(attachment should hide)\nendstream endobj",
      "%%EOF",
    ].join("\n"), "latin1")

    const result = extractPdfLayoutBlocks(pdf)

    expect(result.text).toBe("expected page text")
    expect(result.blocks).toEqual([
      expect.objectContaining({ text: "expected page text", page: 1 }),
    ])
    expect(result.text).not.toContain("attachment should hide")
    expect(result.pageGeometries).toEqual([
      { page: 1, width: 612, height: 792 },
    ])
  })

  it("supports an array of content stream references for one page", () => {
    const pdf = Buffer.from([
      "%PDF-1.4",
      "4 0 obj << /Type /Page /MediaBox [0 0 600 800] /Contents [5 0 R 6 0 R] >> endobj",
      "5 0 obj << /Length 40 >> stream\nBT 10 700 Td (first block) Tj ET\nendstream endobj",
      "6 0 obj << /Length 42 >> stream\nBT 10 650 Td (second block) Tj ET\nendstream endobj",
      "%%EOF",
    ].join("\n"), "latin1")

    const result = extractPdfLayoutBlocks(pdf)

    expect(result.blocks.map((block) => [block.text, block.page])).toEqual([
      ["first block", 1],
      ["second block", 1],
    ])
  })

  it("inflates FlateDecode page content before extracting text", () => {
    const content = deflateSync(Buffer.from("BT 10 700 Td (compressed page text) Tj ET", "latin1"))
    const pdf = Buffer.concat([
      Buffer.from([
        "%PDF-1.4",
        "4 0 obj << /Type /Page /MediaBox [0 0 600 800] /Contents 5 0 R >> endobj",
        `5 0 obj << /Length ${content.length} /Filter /FlateDecode >> stream`,
        "",
      ].join("\n"), "latin1"),
      content,
      Buffer.from("\nendstream endobj\n%%EOF", "latin1"),
    ])

    const result = extractPdfLayoutBlocks(pdf)

    expect(result.text).toBe("compressed page text")
    expect(result.blocks[0]).toEqual(expect.objectContaining({ page: 1 }))
  })
})
