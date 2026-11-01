import { describe, expect, it } from "vitest"

import { dedupeAcademicHits } from "../document/rerank-gateway"
import type { AcademicSearchHit } from "../tools/search-tool"

/**
 * 同一篇论文会被多路检索以不同 URL 形态召回：
 * `#abstract` 锚点、结尾斜杠、`utm_*` 追踪参数、`http` vs `https`。
 * 原来的归一化只做「转小写 + 压空白」，这些形态全部被当成不同文献 ——
 * 于是同一篇论文占掉多个上下文名额，把真正的新结果挤出重排预算。
 */

function hit(url: string, title: string): AcademicSearchHit {
  return { title, url } as AcademicSearchHit
}

const T1 = "Attention Is All You Need"
const T1_ALT = "Attention Is All You Need | arXiv"
const BASE = "https://arxiv.org/abs/1706.03762"

describe("学术检索去重：URL 规范化", () => {
  it("fragment 不同视为同一篇", () => {
    const out = dedupeAcademicHits([hit(`${BASE}#abstract`, T1), hit(`${BASE}#fig1`, T1_ALT)])
    expect(out).toHaveLength(1)
  })

  it("结尾斜杠不同视为同一篇", () => {
    const out = dedupeAcademicHits([hit(`${BASE}/`, T1), hit(BASE, T1_ALT)])
    expect(out).toHaveLength(1)
  })

  it("utm 追踪参数不同视为同一篇", () => {
    const out = dedupeAcademicHits([
      hit(`${BASE}?utm_source=twitter&utm_medium=social`, T1),
      hit(`${BASE}?utm_campaign=newsletter`, T1_ALT),
    ])
    expect(out).toHaveLength(1)
  })

  it("http 与 https 视为同一篇", () => {
    const out = dedupeAcademicHits([hit(`http://arxiv.org/abs/1706.03762`, T1), hit(BASE, T1_ALT)])
    expect(out).toHaveLength(1)
  })

  it("标题大小写与多余空白不同视为同一篇", () => {
    const out = dedupeAcademicHits([
      hit(`${BASE}?v=1`, "Attention  Is All You Need"),
      hit(`${BASE}?v=2`, "attention is all you need"),
    ])
    expect(out).toHaveLength(1)
  })
})

describe("学术检索去重：不过度合并", () => {
  it("不同论文保留", () => {
    const out = dedupeAcademicHits([
      hit("https://arxiv.org/abs/1706.03762", T1),
      hit("https://arxiv.org/abs/1810.04805", "BERT: Pre-training of Deep Bidirectional Transformers"),
    ])
    expect(out).toHaveLength(2)
  })

  it("有语义的查询参数不同时不合并（避免把两篇不同版本当成一篇）", () => {
    const out = dedupeAcademicHits([
      hit(`${BASE}?v=1`, T1),
      hit(`${BASE}?v=2`, T1_ALT),
    ])
    expect(out).toHaveLength(2)
  })

  it("非法 URL 退化为字符串比较，不抛异常", () => {
    const out = dedupeAcademicHits([
      hit("not a url", T1),
      hit("not a url", T1_ALT),
    ])
    expect(out).toHaveLength(1)
  })

  it("空 url 时只按标题去重", () => {
    const out = dedupeAcademicHits([hit("", T1), hit("", "Another Paper")])
    expect(out).toHaveLength(2)
  })
})
