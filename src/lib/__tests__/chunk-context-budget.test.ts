import { describe, expect, it } from "vitest"

import {
  formatAcademicChunksForContext,
  type AcademicChunk,
} from "../document/academic-semantic-chunker"

/**
 * 上下文预算分配。
 *
 * `formatAcademicChunksForContext(chunks, 12)` 原本就是 `chunks.slice(0, 12)` ——
 * 只留**文档头部**。一篇 18 个章节的论文，Discussion / Conclusion 永远进不了
 * RAG 上下文，于是「这篇论文的结论是什么」这类最常见的问题必然答不上来；
 * 而 References 只要落在前 12 个切片里就照样占名额（它没有信息量）。
 */

function chunk(section: string, i: number): AcademicChunk {
  return { text: `正文内容 ${section} #${i}`, metadata: { section, index: i, page: i + 1 } }
}

function longPaper(): AcademicChunk[] {
  const sections = [
    "Abstract",
    "Introduction",
    "Related Work",
    "Background",
    "Methodology",
    "Experiments",
    "Results",
    "Discussion",
    "Limitations",
    "Future Work",
    "Conclusion",
  ]
  const out: AcademicChunk[] = []
  let i = 0
  for (const s of sections) {
    for (let k = 0; k < 2; k += 1) {
      out.push(chunk(s, i))
      i += 1
    }
  }
  return out // 22 个切片：Abstract ×2 … Conclusion ×2（结论在最后两个）
}

describe("RAG 上下文预算：尾部必须保留", () => {
  it("22 个切片时结论仍在上下文里", () => {
    const ctx = formatAcademicChunksForContext(longPaper(), 12)
    expect(ctx).toContain("## [Conclusion")
  })

  it("不超过预算", () => {
    const ctx = formatAcademicChunksForContext(longPaper(), 12)
    expect(ctx.match(/^## \[/gm)?.length).toBe(12)
  })

  it("结论出现在末尾而不是被提到头部（保持原文顺序）", () => {
    const ctx = formatAcademicChunksForContext(longPaper(), 12)
    const first = ctx.indexOf("## [Abstract")
    const last = ctx.indexOf("## [Conclusion")
    expect(first).toBeGreaterThan(-1)
    expect(last).toBeGreaterThan(first)
  })

  it("短文档全部保留，顺序不变", () => {
    const short = [chunk("Abstract", 0), chunk("Methodology", 1), chunk("Conclusion", 2)]
    const ctx = formatAcademicChunksForContext(short, 12)
    expect(ctx.indexOf("## [Abstract")).toBeLessThan(ctx.indexOf("## [Methodology"))
    expect(ctx.indexOf("## [Methodology")).toBeLessThan(ctx.indexOf("## [Conclusion"))
  })
})

describe("RAG 上下文预算：参考文献不占名额", () => {
  it("References 落在前 12 个切片内时被剔除", () => {
    const chunks = [
      chunk("Abstract", 0),
      chunk("References", 1),
      chunk("Introduction", 2),
      chunk("Conclusion", 3),
    ]
    const ctx = formatAcademicChunksForContext(chunks, 3)
    expect(ctx).not.toContain("## [References")
    expect(ctx).toContain("## [Conclusion")
  })

  it("整篇只有参考文献时不返回空上下文", () => {
    const chunks = [chunk("References", 0), chunk("References", 1)]
    const ctx = formatAcademicChunksForContext(chunks, 12)
    expect(ctx).toContain("## [References")
  })
})

describe("RAG 上下文预算：装得下时不许丢内容", () => {
  it("References 标题之后的正文不会被噪声过滤整段删掉（拼接论文场景）", () => {
    // 真实场景：多篇论文拼接、或附录里继续放正文时，References 之后仍有内容。
    // 只要总量没超预算，就不该因为「章节名像噪声」而丢字。
    const chunks = [
      chunk("Abstract", 0),
      chunk("References", 1),
      chunk("References", 2),
      chunk("References", 3),
    ]
    const ctx = formatAcademicChunksForContext(chunks, 12)
    expect(ctx.match(/^## \[/gm)?.length).toBe(4)
    expect(ctx).toContain("正文内容 References #3")
  })
})
