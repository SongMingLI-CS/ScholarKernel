import { describe, expect, it } from "vitest"

import { extractPdfLayoutBlocks } from "../document/pdf-text-extract"

/**
 * PDF 字面量串（`(...)`）的解码规则在规范 7.3.4.2 里写得很清楚，
 * 但实现只有 6 行链式 `replace` 加一条正则 token 化，于是漏了三类：
 *
 * 1. **八进制转义 `\ddd`** 完全不支持。LaTeX/Word 生成的 PDF 里
 *    `\050A\051` 就是 `(A)`，现在会原样输出反斜杠数字。
 * 2. **链式 replace 的顺序**把 `\\n`（转义的反斜杠 + 字母 n）吃成
 *    「反斜杠 + 换行」—— 因为 `/\\n/` 先于 `/\\\\/` 执行。
 * 3. **嵌套括号**：字面量里合法地出现 `(` `)` 时，token 正则在第一个 `)` 处截断，
 *    `Tj` 的操作数取不到，**整段文字被静默丢弃**（不报错、无兜底提示）。
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

describe("PDF 字面量串解码：八进制转义", () => {
  it("\\050 与 \\051 分别解码为左右括号", () => {
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (\\050A\\051) Tj ET"))
    expect(out.text).toBe("(A)")
  })

  it("\\101\\102\\103 解码为 ABC", () => {
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (\\101\\102\\103) Tj ET"))
    expect(out.text).toBe("ABC")
  })

  it("八进制只取最多三位（\\0512 是 ) 后面跟 2）", () => {
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (\\0512) Tj ET"))
    expect(out.text).toBe(")2")
  })
})

describe("PDF 字面量串解码：转义与顺序", () => {
  it("\\\\ 先于 \\n 处理：\\n 里那两个字面量是反斜杠 + 字母 n", () => {
    // PDF 字节：a \ \ n b   → 规范：\\ → \ ，于是结果是 a\ n b 四个字符
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (a\\\\nb) Tj ET"))
    expect(out.text).toBe("a\\nb")
  })

  it("行尾反斜杠是续行，不产生字符", () => {
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (line1\\\nline2) Tj ET"))
    expect(out.text).toBe("line1line2")
  })

  it("\\b 与 \\f 按规范解码为退格与换页", () => {
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (a\\bb) Tj ET"))
    expect(out.text).toBe("a\bb")
  })
})

describe("PDF 字面量串：括号嵌套", () => {
  it("字面量内的平衡括号必须保留，且整段不被丢弃", () => {
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (Outer (Inner) Tail) Tj ET"))
    expect(out.text).toBe("Outer (Inner) Tail")
  })

  it("多层嵌套同样完整", () => {
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (a (b (c) d) e) Tj ET"))
    expect(out.text).toBe("a (b (c) d) e")
  })

  it("嵌套括号里的八进制转义仍按规范解码", () => {
    const out = extractPdfLayoutBlocks(buildPdf("BT 72 700 Td (x\\050y\\051z) Tj ET"))
    expect(out.text).toBe("x(y)z")
  })
})
