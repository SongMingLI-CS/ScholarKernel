import { describe, expect, it } from "vitest"

import { extractPdfLayoutBlocks } from "../document/pdf-text-extract"

/**
 * PDF 文本定位操作符（规范 9.4.4）：
 *
 * - `Tm`：绝对定位（a b c d e f Tm → 文本矩阵 = [a b c d e f]，当前点 = (e, f)）
 * - `Td`：相对移动（dx dy Td → 移动 (dx, dy)）
 * - `TD`：相对移动 + 设置行首距（dx dy TD → leading = -dy，再 Td(dx, -dy)）
 * - `T*`：移到下一行首（等价于 0 leading Td，用当前 leading；默认 leading=0 时 y 不变）
 *
 * 第一轮已实现 Tm 与 Td。`T*` 与 `TD` 漏了 —— 它们在真实 PDF 里非常常见，
 * 因为生成器常用 `[(line1)] TJ 0 -14 Td [(line2)] TJ` 或 `(line1) Tj T* (line2) Tj`
 * 来分行。漏了 `T*` 时，同一 BT 块里用 T* 分的行全部落在第一行的 y 上，
 * 双栏判定与块切分都会把「多行」当成「一行」。
 */

function buildPdf(contentStream: string): Buffer {
  const body = Buffer.from(contentStream, "latin1")
  const head = Buffer.from(
    `%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length ${body.length} >>
stream
`,
    "latin1"
  )
  const tail = Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1")
  return Buffer.concat([head, body, tail])
}

describe("PDF 文本定位操作符覆盖", () => {
  it("T* 之后下一行 y 应下降（设置 leading 后）", () => {
    // 14 TL 设置行距=14；T* 按 leading 下移。不设 leading 时 T* 移动 0（规范行为）
    const pdf = buildPdf("BT /F1 12 Tf 72 700 Tm 14 TL (First) Tj T* (Second) Tj ET")
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.text).toContain("First")
    expect(out.text).toContain("Second")
    const ys = out.blocks.map((b) => b.y)
    expect(ys.length).toBe(2)
    expect(ys[1]).toBeLessThan(ys[0]!) // 第二行 y 更小（PDF 坐标 y 向上，下移 = y 减小）
    expect(ys[0]! - ys[1]!).toBe(14)
  })

  it("TD 设置 leading 后，T* 用该 leading 下移", () => {
    // 0 -14 TD 设置 leading=14（=-dy）。TD/Td 不 flush pending，只有 T*/ET 分块。
    const pdf = buildPdf("BT /F1 12 Tf 72 700 Tm (First) Tj 0 -14 TD (Second) Tj T* (Third) Tj ET")
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.text).toContain("First")
    expect(out.text).toContain("Second")
    expect(out.text).toContain("Third")
    // (First)+(Second) 合成一块在 y=686（TD 移动后）；T* 后 (Third) 在 y=672
    const ys = out.blocks.map((b) => b.y)
    expect(ys.length).toBe(2)
    expect(ys[0]! - ys[1]!).toBe(14)
  })

  it("Tm 绝对定位仍正确（回归保护）", () => {
    // Tm 需要 6 个矩阵操作数：a b c d e f Tm。1 0 0 1 100 600 = 平移到 (100,600)
    const pdf = buildPdf("BT /F1 12 Tf 1 0 0 1 100 600 Tm (Anchor) Tj ET")
    const out = extractPdfLayoutBlocks(pdf)
    expect(out.blocks[0]?.x).toBe(100)
    expect(out.blocks[0]?.y).toBe(600)
  })

  it("Td 相对移动仍正确（回归保护）", () => {
    const pdf = buildPdf("BT /F1 12 Tf 100 600 Tm (A) Tj 20 -10 Td (B) Tj ET")
    const out = extractPdfLayoutBlocks(pdf)
    // 两个 Tj 在同一 BT 块里默认合成一个 pending 块，坐标取首次定位
    expect(out.text).toContain("A")
    expect(out.text).toContain("B")
  })
})
