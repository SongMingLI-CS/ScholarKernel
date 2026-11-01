import { describe, expect, it } from "vitest"

import { applyColumnReorder, reorderInterleavedPlainText } from "@/lib/document/column-reorder"
import { parseLayoutAwareDocument } from "@/lib/document/layout-aware-parser"

/**
 * 回归：单栏文档绝不能被纯文本奇偶行启发式重排。
 * 该启发式无法从文本本身证明「双栏」，历史实现会让 Markdown / 纯文本 / 单栏 PDF
 * 的段落顺序整体错位（奇偶行交换），并以 layout="double" 静默标记为成功。
 */
const SINGLE_COLUMN_PROSE = [
  "第一章 绪论：本文研究检索增强生成系统的可靠性问题。",
  "我们首先回顾了近年来关于稠密检索与重排序的相关工作。",
  "随后提出了一个基于语义切片的文档摄取流水线。",
  "该流水线在解析阶段保留页码与章节元数据。",
  "实验部分在三个公开数据集上进行了评测。",
  "结果表明该方法在召回率上有一致提升。",
  "最后我们讨论了方法的局限性和未来工作方向。",
  "附录给出了完整的实验配置与超参数设置。",
  "参考文献列出了本文引用的全部相关文献列表。",
  "致谢部分感谢了参与讨论的同行与评审专家。",
].join("\n")

const MARKDOWN_DOC = [
  "# ScholarKernel",
  "",
  "- 文档摄取：PDF / DOCX / Markdown",
  "- 检索：BM25 + 向量 + 重排",
  "- Agent：规划 / 执行 / 同行评审",
  "",
  "## 快速开始",
  "",
  "安装依赖后运行开发服务器。",
  "所有配置通过环境变量注入。",
  "测试使用 vitest 运行。",
].join("\n")

describe("applyColumnReorder plain-text safety", () => {
  it("preserves single-column prose byte-for-byte by default", () => {
    const out = applyColumnReorder(SINGLE_COLUMN_PROSE)
    expect(out.text).toBe(SINGLE_COLUMN_PROSE.trim())
    expect(out.layout).not.toBe("double")
  })

  it("preserves markdown order by default", () => {
    const out = applyColumnReorder(MARKDOWN_DOC)
    expect(out.text).toBe(MARKDOWN_DOC.trim())
    expect(out.layout).not.toBe("double")
    expect(out.text.startsWith("# ScholarKernel")).toBe(true)
  })

  it("still reorders when the caller explicitly opts in", () => {
    const interleaved = ["L1", "R1", "L2", "R2", "L3", "R3", "L4", "R4"].join("\n")
    const out = applyColumnReorder(interleaved, undefined, undefined, { plainTextHeuristic: true })
    expect(out.layout).toBe("double")
    expect(out.text.startsWith("L1\nL2\nL3\nL4")).toBe(true)
  })

  it("keeps the exported heuristic function available for explicit use", () => {
    const interleaved = ["L1", "R1", "L2", "R2", "L3", "R3", "L4", "R4"].join("\n")
    const out = reorderInterleavedPlainText(interleaved)
    expect(out.layout).toBe("double")
    expect(out.text).toBe("L1\nL2\nL3\nL4\nR1\nR2\nR3\nR4")
  })
})

describe("parseLayoutAwareDocument plain-text ingestion", () => {
  it("does not reorder uploaded markdown", async () => {
    const parsed = await parseLayoutAwareDocument({
      buffer: Buffer.from(MARKDOWN_DOC, "utf8"),
      filename: "notes.md",
    })
    expect(parsed.format).toBe("text")
    expect(parsed.text.startsWith("# ScholarKernel")).toBe(true)
    expect(parsed.layout).not.toBe("double")
  })

  it("does not reorder uploaded plain text", async () => {
    const parsed = await parseLayoutAwareDocument({
      buffer: Buffer.from(SINGLE_COLUMN_PROSE, "utf8"),
      filename: "paper.txt",
    })
    expect(parsed.text.split("\n")[0]).toBe(SINGLE_COLUMN_PROSE.split("\n")[0])
    expect(parsed.text.split("\n")[1]).toBe(SINGLE_COLUMN_PROSE.split("\n")[1])
  })
})
