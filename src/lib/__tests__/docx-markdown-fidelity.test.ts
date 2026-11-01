import { inflateRawSync } from "node:zlib"

import { describe, expect, it } from "vitest"

import { extractDocxFromBuffer } from "../document/docx-text-extract"
import { exportMarkdownAsDocx } from "../export-utils"
import type { ExportMetadata } from "../export-metadata"

/**
 * DOCX 导出的 Markdown 保真度。
 *
 * `exportMarkdownAsDocx` 是**手写的**逐行渲染器（不走 marked），
 * 因此 `marked` 支持的语法它必须逐条自己实现 —— 漏一条就会把语法字符
 * 原样写进 Word 文档。这里锁住四类：代码围栏、代码缩进、引用块、列表内行内样式。
 */

/** 从 docx 缓冲里取出 word/document.xml 原文（local file header 顺序扫描）。 */
function readDocumentXml(buf: Buffer): string {
  let i = 0
  while (i < buf.length - 4) {
    if (buf.readUInt32LE(i) !== 0x04034b50) {
      i += 1
      continue
    }
    const nameLen = buf.readUInt16LE(i + 26)
    const extraLen = buf.readUInt16LE(i + 28)
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf8")
    const compSize = buf.readUInt32LE(i + 18)
    const start = i + 30 + nameLen + extraLen
    if (name === "word/document.xml") {
      return inflateRawSync(buf.subarray(start, start + compSize)).toString("utf8")
    }
    i = start + compSize
  }
  throw new Error("word/document.xml not found")
}

async function render(markdown: string, meta?: ExportMetadata) {
  const blob = await exportMarkdownAsDocx("标题", markdown, meta)
  const buf = Buffer.from(await blob.arrayBuffer())
  return { text: extractDocxFromBuffer(buf), xml: readDocumentXml(buf) }
}

const META: ExportMetadata = {
  model: "gpt-4o-mini",
  retrievalDate: "2026-11-02",
  exportedAt: "2026-11-02 03:00",
}

const CODE_MD = ["## 实现", "", "```python", "def fib(n):", "    if n < 2:", "        return n", "    return fib(n - 1)", "```", "", "结尾段落"].join("\n")

describe("DOCX 导出：代码块", () => {
  it("围栏标记不写进正文", async () => {
    const { text } = await render(CODE_MD)
    expect(text).not.toContain("```")
    expect(text).not.toContain("```python")
  })

  it("代码缩进原样保留（Python 缩进是语义，不能被 trim 掉）", async () => {
    // 用 XML 断言而不是回读文本：`extractDocxFromBuffer` 是**摄取**侧的提取器，
    // 它按段落 trim（对 RAG 合理），会把缩进信息抹掉，不能用来验证渲染保真度。
    // Word 侧看到的是 w:t 的内容 + xml:space="preserve"，这里就断言这两者。
    const { xml } = await render(CODE_MD)
    expect(xml).toContain(`xml:space="preserve">    if n &lt; 2:`)
    expect(xml).toContain(`xml:space="preserve">        return n`)
  })

  it("代码行用等宽字体，与正文区分", async () => {
    const { xml } = await render(CODE_MD)
    expect(xml).toMatch(/w:ascii="(Consolas|Courier New)"/)
  })

  it("未闭合围栏不会吞掉后续正文", async () => {
    const { text } = await render(["```js", "const a = 1", "", "## 后续章节", "正文在这"].join("\n"))
    expect(text).toContain("后续章节")
    expect(text).toContain("正文在这")
    expect(text).not.toContain("```")
  })

  it("行内三反引号不会被误判成围栏（否则会吞掉后文）", async () => {
    const { text } = await render(["这里写 ```code``` 然后继续", "", "正文二"].join("\n"))
    expect(text).toContain("正文二")
    expect(text).toContain("```code``` 然后继续")
  })
})

describe("DOCX 导出：分隔线", () => {
  it("`---` 不产生字面横线字符", async () => {
    const { text, xml } = await render(["上段", "", "---", "", "下段"].join("\n"))
    expect(text).not.toContain("---")
    expect(text).toContain("上段")
    expect(text).toContain("下段")
    expect(xml).toMatch(/<w:pBdr>/)
  })
})

describe("DOCX 导出：引用块", () => {
  it("`>` 标记不残留", async () => {
    const { text } = await render("> 这是一段引用\n> 引用的第二行")
    const lines = text.split("\n").map((l) => l.trim())
    expect(lines).toContain("这是一段引用")
    expect(lines).toContain("引用的第二行")
    expect(lines.some((l) => l.startsWith(">"))).toBe(false)
  })

  it("引用块内的行内样式仍然生效", async () => {
    const { text, xml } = await render("> **重点**：结论")
    expect(text).toContain("重点：结论")
    expect(text).not.toContain("**")
    expect(xml).toMatch(/<w:b\/>/)
  })

  it("导出元数据头不再出现 `>` 前缀", async () => {
    const { text } = await render("正文", META)
    expect(text).toContain("模型：gpt-4o-mini")
    expect(text).not.toContain("> 模型")
    expect(text.split("\n").some((l) => l.trimStart().startsWith(">"))).toBe(false)
  })
})

describe("DOCX 导出：列表", () => {
  it("列表项内的粗体不再输出字面星号", async () => {
    const { text, xml } = await render("- 第一项 **重点** 收尾\n- 第二项")
    expect(text).not.toContain("**")
    expect(text).toContain("第一项 重点 收尾")
    expect(xml).toMatch(/<w:b\/>/)
  })
})
