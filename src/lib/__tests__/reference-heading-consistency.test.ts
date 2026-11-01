import { describe, expect, it } from "vitest"

import { normalizeReferenceSections } from "../reference-sections"
import { extractReferencesFromMarkdown } from "../utils/citation-parser"

/**
 * 识别「参考文献区」有两套实现，判据不一致：
 *
 * - `reference-sections.ts`：`#{1,6}` + `参考文献|References|Bibliography`
 * - `citation-parser.ts`：`#{1,3}` + `参考文献|references?`（没有 Bibliography）
 *
 * 于是 `## Bibliography`（IEEE/ACM 常见写法）会被前者当成文献区搬走，
 * 后者却一条都解析不出来 —— 导出时文献列表凭空清空。
 */
describe("两处文献区判据必须一致", () => {
  const DOC = ["## Bibliography", "[1] Vaswani A. (2017). Attention is all you need. NeurIPS.", ""].join("\n")

  it("Bibliography 标题能被解析出文献条目", () => {
    const refs = extractReferencesFromMarkdown(DOC)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.title).toContain("Attention is all you need")
    expect(refs[0]!.year).toBe("2017")
  })

  it("四级标题下的文献区同样能解析", () => {
    const doc = ["#### 参考文献", "[1] 张三 (2021). 检索增强生成综述. 计算机学报."].join("\n")
    expect(extractReferencesFromMarkdown(doc)).toHaveLength(1)
  })

  it("两套实现认定的文献区起点一致", () => {
    // 规范化器把文献区收拢并重命名为统一标题，解析器应当从同一位置开始
    const normalized = normalizeReferenceSections(DOC)
    expect(normalized).toContain("## 参考文献 (References)")
    expect(extractReferencesFromMarkdown(normalized)).toHaveLength(1)
  })
})
