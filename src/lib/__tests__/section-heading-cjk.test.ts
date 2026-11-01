import { describe, expect, it } from "vitest"

import { detectSectionTitle, semanticChunkAcademicText } from "../document/academic-semantic-chunker"

/**
 * `SECTION_HEADING_RE` 只列英文关键字（Abstract / Introduction / …），
 * 中文论文的「摘要 / 引言 / 相关工作 / 参考文献」一个都不匹配。
 *
 * 后果不是「少一个标题」而是**整篇塌成一个 chunk**：
 * `splitIntoSections` 全程命中不到标题，所有内容留在 "Preamble" 里，
 * 于是章节元数据、页码推断、按章节引用全部失效。
 *
 * 另一个坑：中文后面不能加 `\\b` —— `\\w` 只含 `[A-Za-z0-9_]`，
 * CJK 不构成词边界，`(摘要)\\b` 永远不会匹配（与 SK-33 同一根因）。
 */
describe("中文章节标题识别", () => {
  it("识别常见中文章节名", () => {
    expect(detectSectionTitle("摘要")).toBe("Abstract")
    expect(detectSectionTitle("引言")).toBe("Introduction")
    expect(detectSectionTitle("1 引言")).toBe("Introduction")
    expect(detectSectionTitle("2. 相关工作")).toBe("Related Work")
    expect(detectSectionTitle("3 方法")).toBe("Methodology")
    expect(detectSectionTitle("4 实验")).toBe("Experiments")
    expect(detectSectionTitle("5 结论")).toBe("Conclusion")
    expect(detectSectionTitle("参考文献")).toBe("References")
  })

  it("Markdown 形式的中文标题同样归一", () => {
    expect(detectSectionTitle("## 摘要")).toBe("Abstract")
    expect(detectSectionTitle("### 参考文献")).toBe("References")
  })

  it("中文正文行不会被当成标题", () => {
    expect(detectSectionTitle("结果表明，该方法在三个数据集上都优于基线。")).toBeNull()
    expect(
      detectSectionTitle("本文提出一种新的图神经网络结构，用于分子性质预测，并在公开数据集上验证了有效性。")
    ).toBeNull()
  })

  it("以章节名开头、但明显是正文的长句不当标题", () => {
    // 没有句末标点的长正文行：靠长度上限拦下
    expect(detectSectionTitle("结论需要我们进一步在更大规模的真实业务数据集上做长期验证才能确定是否成立")).toBeNull()
  })

  it("中文文档能切出多个章节而不是一个 Preamble", () => {
    const text = [
      "摘要",
      "本文研究中文论文的章节切分问题并给出实验。",
      "1 引言",
      "深度学习在学术检索中被广泛使用。",
      "2 相关工作",
      "已有工作多基于英文语料。",
      "3 实验",
      "我们在三个数据集上验证了方法的有效性。",
      "参考文献",
      "[1] 张三. 检索增强生成综述. 2024.",
    ].join("\n")

    const chunks = semanticChunkAcademicText({ text })
    const sections = chunks.map((c) => c.metadata.section)
    expect(sections).toEqual(["Abstract", "Introduction", "Related Work", "Experiments", "References"])
  })
})
