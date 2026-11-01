import { describe, expect, it } from "vitest"

import { lexicalRerankScores } from "../document/rerank-gateway"

/**
 * `tokenize` 只按空白切词，而中文没有空格：
 *
 *   "本文提出一种深度学习模型的训练方法".split(/\s+/) -> ["本文提出一种深度学习模型的训练方法"]
 *
 * 整句成了**一个 token**，查询 "深度学习" 永远匹配不上 —— 于是中文查询的
 * 词项重排全是 0 分，`rerank-gateway` 只能退回原始召回顺序，
 * 兜底重排对中文等于没开。
 */
describe("lexicalRerankScores 的中文分词", () => {
  it("中文查询能命中包含该词的文档", () => {
    const docs = ["本文提出一种深度学习模型的训练方法", "蛋白质结构预测的实验结果"]
    const scores = lexicalRerankScores("深度学习", docs)
    expect(scores[0]!.score).toBeGreaterThan(0)
    expect(scores[0]!.score).toBeGreaterThan(scores[1]!.score)
  })

  it("查询词被空格分开时也能命中（文档未断句）", () => {
    const scores = lexicalRerankScores("深度 学习", ["本文研究深度学习，并给出实验"])
    expect(scores[0]!.score).toBeGreaterThan(0)
  })

  it("标点会把 CJK 段切开，不拼接成跨标点的词", () => {
    // 若把 "深度，学习" 先并成 "深度学习"，就会出现 "度学" 这个伪词
    const scores = lexicalRerankScores("度学", ["深度，学习"])
    expect(scores[0]!.score).toBe(0)
  })

  it("英文排序结果保持不变", () => {
    const docs = ["attention is all you need", "protein folding prediction"]
    const scores = lexicalRerankScores("transformer attention mechanism", docs)
    expect(scores[0]!.score).toBeGreaterThan(scores[1]!.score)
    expect(scores[1]!.score).toBe(0)
  })

  it("中英混排各走各的规则", () => {
    const docs = ["用 transformer 做机器翻译", "蛋白质结构预测"]
    const scores = lexicalRerankScores("transformer 机器翻译", docs)
    expect(scores[0]!.score).toBeGreaterThan(0)
    expect(scores[0]!.score).toBeGreaterThan(scores[1]!.score)
  })
})
