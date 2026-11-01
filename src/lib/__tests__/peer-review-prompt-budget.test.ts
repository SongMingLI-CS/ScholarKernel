import { describe, expect, it } from "vitest"

import { enrichPeerReviewSubject } from "@/lib/agent/peer-review-runner"

function section(name: string, lines: number): string {
  return [
    `# ${name}`,
    ...Array.from({ length: lines }, (_, i) => `段落 ${i}（${name}）：讨论了注意力机制、检索增强与重排序的相关工作与实验结果。`),
  ].join("\n")
}

const MARKER = "段落 7（Methodology）：讨论了注意力机制、检索增强与重排序的相关工作与实验结果。"
const PAPER = [section("Abstract", 6), section("Introduction", 10), section("Methodology", 12), section("Experiments", 10), section("Conclusion", 5)].join("\n\n")

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * 回归：enrichPeerReviewSubject 曾把「全文」与「全文的语义切片」同时拼进提示词，
 * 同一篇稿件在 prompt 里出现两次（实测 2.10x 字符量），
 * 直接翻倍 token 成本，并让长稿极易超出上下文窗口。
 */
describe("enrichPeerReviewSubject token budget", () => {
  it("does not duplicate the submission in the prompt", () => {
    const enriched = enrichPeerReviewSubject(PAPER)
    expect(enriched).toContain(MARKER)
    expect(occurrences(enriched, MARKER)).toBe(1)
  })

  it("keeps prompt growth bounded instead of doubling it", () => {
    const enriched = enrichPeerReviewSubject(PAPER)
    const ratio = enriched.length / PAPER.length
    expect(ratio).toBeLessThan(1.25)
  })

  it("still emits section-tagged RAG structure", () => {
    const enriched = enrichPeerReviewSubject(PAPER)
    expect(enriched).toContain("[学术语义切片")
    expect(enriched).toContain("[Abstract")
    expect(enriched).toContain("[Methodology")
  })

  it("does not truncate later sections away", () => {
    const enriched = enrichPeerReviewSubject(PAPER)
    expect(enriched).toContain("[Conclusion")
  })

  it("leaves short submissions untouched", () => {
    const short = "Short abstract about RAG."
    expect(enrichPeerReviewSubject(short)).toBe(short)
  })
})
