import { describe, expect, it } from "vitest"

import { serializeReferencesAsBibTeX, serializeReferencesAsRIS } from "../utils/citation-parser"

/**
 * 参考文献序列化与 `citation-export.ts` 是**两条独立的实现**：
 * 后者在 SK-49 里补了转义/去重/换行，前者还是老的「删掉花括号」版本。
 * 同一个产品里两处导出格式不一致，出错的是用户导入文献后的那次导出。
 */
const ref = (over: Partial<{ id: string; title: string; authors: string[]; year: string; journal: string; doi: string }> = {}) => ({
  id: "",
  type: "article" as const,
  title: "Attention is all you need",
  authors: ["Vaswani, A."],
  year: "2017",
  journal: null,
  doi: null,
  raw: "",
  ...over,
})

describe("serializeReferencesAsBibTeX 的转义", () => {
  it("转义 BibTeX 特殊字符", () => {
    const out = serializeReferencesAsBibTeX([ref({ title: "BERT_pre-training & 100% gains", journal: "J. of A&B" })])
    expect(out).toContain("title = {BERT\\_pre-training \\& 100\\% gains}")
    expect(out).toContain("journal = {J. of A\\&B}")
  })

  it("引用键在条目之间唯一", () => {
    const out = serializeReferencesAsBibTeX([
      ref({ id: "same", title: "Paper A" }),
      ref({ id: "same", title: "Paper B" }),
      ref({ id: "same", title: "Paper C" }),
    ])
    const keys = [...out.matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1])
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
  })

  it("中文标题得到非空且互不相同的引用键", () => {
    const out = serializeReferencesAsBibTeX([
      ref({ title: "检索增强生成综述" }),
      ref({ title: "图神经网络分子预测" }),
    ])
    const keys = [...out.matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1])
    expect(keys.every((k) => (k ?? "").length > 0)).toBe(true)
    expect(new Set(keys).size).toBe(2)
  })
})

describe("serializeReferencesAsRIS 的字段", () => {
  it("换行被折成空格，记录结构不被破坏", () => {
    const out = serializeReferencesAsRIS([ref({ title: "Line one\nLine two", journal: "J\nX" })])
    expect(out.split("\n").filter((l) => l.startsWith("TI  - "))).toEqual(["TI  - Line one Line two"])
    expect(out.split("\n").filter((l) => l.startsWith("JO  - "))).toEqual(["JO  - J X"])
  })
})
