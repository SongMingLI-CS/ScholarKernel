import { describe, expect, it } from "vitest"

import { exportSourcesAsBibTeX, exportSourcesAsRIS } from "../citation-export"

/**
 * 导出文件是直接交给 Zotero / EndNote / BibTeX 解析的，
 * 字段里的特殊字符不转义、引用键不唯一、换行不折叠，都会让整个库报错或错位。
 */
const src = (over: Partial<{ title: string; url: string; snippet: string; publishedAt: string }> = {}) => ({
  title: "Attention is all you need",
  url: "https://example.com/a",
  ...over,
})

describe("BibTeX 导出", () => {
  it("转义 _ % & # $ 等 BibTeX 特殊字符", () => {
    const out = exportSourcesAsBibTeX([src({ title: "BERT_pre-training & fine-tuning: 100% gains", url: "https://x.test/a%20b" })])
    expect(out).toContain("BERT\\_pre-training \\& fine-tuning: 100\\% gains")
    expect(out).toContain("https://x.test/a\\%20b")
  })

  it("转义反斜杠与花括号，保持条目结构完整", () => {
    const out = exportSourcesAsBibTeX([src({ title: "C:\\path\\to {x}" })])
    expect(out).toContain("C:\\textbackslash{}path\\textbackslash{}to \\{x\\}")
    // 花括号必须配对，否则 BibTeX 直接解析失败
    expect((out.match(/\{/g) ?? []).length).toBe((out.match(/\}/g) ?? []).length)
  })

  it("引用键在条目之间唯一", () => {
    const out = exportSourcesAsBibTeX([
      src({ title: "Deep Learning Approach for Alpha", url: "https://x.test/1" }),
      src({ title: "Deep Learning Approach for Beta", url: "https://x.test/2" }),
      src({ title: "Deep Learning Approach for Gamma", url: "https://x.test/3" }),
    ])
    const keys = [...out.matchAll(/@misc\{([^,]+),/g)].map((m) => m[1])
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
  })

  it("中文标题退化为 refN 且互不重复", () => {
    const out = exportSourcesAsBibTeX([
      src({ title: "检索增强生成综述", url: "https://x.test/1" }),
      src({ title: "图神经网络在分子预测中的应用", url: "https://x.test/2" }),
    ])
    const keys = [...out.matchAll(/@misc\{([^,]+),/g)].map((m) => m[1])
    expect(new Set(keys).size).toBe(2)
    expect(keys.every((k) => k && k.length > 0)).toBe(true)
  })

  it("完整日期只取年份", () => {
    const out = exportSourcesAsBibTeX([src({ publishedAt: "2024-05-01" })])
    expect(out).toContain("year = {2024}")
  })

  it("没有年份信息时不写 year 字段", () => {
    const out = exportSourcesAsBibTeX([src({ publishedAt: "" })])
    expect(out).not.toContain("year =")
  })
})

describe("RIS 导出", () => {
  it("把字段里的换行折成空格，避免破坏记录结构", () => {
    const out = exportSourcesAsRIS([src({ title: "Line one\nLine two", snippet: "a\r\nb" })])
    const ti = out.split("\n").filter((l) => l.startsWith("TI  - "))
    expect(ti).toHaveLength(1)
    expect(ti[0]).toBe("TI  - Line one Line two")
    expect(out.split("\n").filter((l) => l.startsWith("N1  - "))).toHaveLength(1)
  })

  it("每条记录都以 ER  - 结束", () => {
    const out = exportSourcesAsRIS([src({ url: "https://x.test/1" }), src({ url: "https://x.test/2" })])
    expect(out.match(/^ER {2}- /gm)).toHaveLength(2)
    expect(out.match(/^TY {2}- /gm)).toHaveLength(2)
  })
})
