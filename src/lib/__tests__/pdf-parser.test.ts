import { deflateSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  parseLayoutAwareDocument,
  setExternalLayoutParser,
} from "@/lib/document/layout-aware-parser"
import { MAX_PDF_BYTES } from "@/lib/document/pdf-text-extract"

function makePdf(content: string, compress = false): Buffer {
  const contentBytes = Buffer.from(content, "latin1")
  const streamBytes = compress ? deflateSync(contentBytes) : contentBytes
  const filter = compress ? " /Filter /FlateDecode" : ""
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "latin1"
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "latin1"),
    Buffer.concat([
      Buffer.from(`<< /Length ${streamBytes.length}${filter} >>\nstream\n`, "latin1"),
      streamBytes,
      Buffer.from("\nendstream", "latin1"),
    ]),
  ]

  const parts = [Buffer.from("%PDF-1.7\n", "latin1")]
  const offsets: number[] = []
  let byteLength = parts[0]!.length
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(byteLength)
    const object = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      objects[index]!,
      Buffer.from("\nendobj\n", "latin1"),
    ])
    parts.push(object)
    byteLength += object.length
  }

  const xrefOffset = byteLength
  const xref = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "]
  for (const offset of offsets) xref.push(`${String(offset).padStart(10, "0")} 00000 n `)
  const trailer = `\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  parts.push(Buffer.from(`${xref.join("\n")}${trailer}`, "latin1"))
  return Buffer.concat(parts)
}

async function parsePdf(buffer: Buffer) {
  return await parseLayoutAwareDocument({
    buffer,
    filename: "academic-paper.pdf",
    mimeType: "application/pdf",
  })
}

describe("PDF parsing", () => {
  beforeEach(() => {
    vi.stubEnv("LAYOUT_PARSER_URL", "")
    vi.stubEnv("LAYOUT_PARSER_API_KEY", "")
    setExternalLayoutParser(null)
  })

  afterEach(() => {
    setExternalLayoutParser(null)
    vi.unstubAllEnvs()
  })

  it("extracts text from a legal single-column PDF", async () => {
    const pdf = makePdf(
      [
        "BT /F1 12 Tf 72 720 Td (Single column opening sentence.) Tj ET",
        "BT /F1 12 Tf 72 700 Td (Single column second sentence.) Tj ET",
      ].join("\n")
    )

    const parsed = await parsePdf(pdf)

    expect(parsed.format).toBe("pdf")
    expect(parsed.layout).toBe("single")
    expect(parsed.parser).toBe("local")
    expect(parsed.text).toContain("Single column opening sentence.")
    expect(parsed.text.indexOf("opening sentence")).toBeLessThan(
      parsed.text.indexOf("second sentence")
    )
  })

  it("reorders a legal two-column PDF by column", async () => {
    const pdf = makePdf(
      [
        "BT /F1 12 Tf 50 720 Td (LEFT TOP.) Tj ET",
        "BT /F1 12 Tf 340 720 Td (RIGHT TOP.) Tj ET",
        "BT /F1 12 Tf 50 700 Td (LEFT BOTTOM.) Tj ET",
        "BT /F1 12 Tf 340 700 Td (RIGHT BOTTOM.) Tj ET",
      ].join("\n")
    )

    const parsed = await parsePdf(pdf)

    expect(parsed.layout).toBe("double")
    expect(parsed.text.indexOf("LEFT TOP.")).toBeLessThan(parsed.text.indexOf("LEFT BOTTOM."))
    expect(parsed.text.indexOf("LEFT BOTTOM.")).toBeLessThan(parsed.text.indexOf("RIGHT TOP."))
    expect(parsed.text.indexOf("RIGHT TOP.")).toBeLessThan(parsed.text.indexOf("RIGHT BOTTOM."))
  })

  it("extracts text from a Flate-compressed PDF content stream", async () => {
    const pdf = makePdf(
      "BT /F1 12 Tf 72 720 Td (Compressed academic content is readable.) Tj ET",
      true
    )

    const parsed = await parsePdf(pdf)

    expect(parsed.text).toContain("Compressed academic content is readable.")
  })

  it("explains when a valid blank PDF contains no extractable text", async () => {
    await expect(parsePdf(makePdf(""))).rejects.toMatchObject({
      code: "PDF_NO_TEXT",
      message: expect.stringContaining("空白页"),
    })
  })

  it("explains when a PDF is malformed or unsupported", async () => {
    await expect(parsePdf(Buffer.from("%PDF-1.7\nnot a valid PDF"))).rejects.toMatchObject({
      message: expect.stringMatching(/无法读取|未能从该 PDF|暂不支持/),
    })
  })

  it("rejects PDFs above the configured size limit before parsing", async () => {
    await expect(parsePdf(Buffer.alloc(MAX_PDF_BYTES + 1))).rejects.toMatchObject({
      code: "PDF_TOO_LARGE",
      status: 413,
    })
  })
})
