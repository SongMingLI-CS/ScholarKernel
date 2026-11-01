import { describe, expect, it } from "vitest"

import {
  hasPeerReviewScoreGap,
  shouldTriggerPeerReviewBreakpoint,
} from "../agent/peer-review-score-gap"

/**
 * 该函数的全部中文分支曾经是死代码。
 *
 * `\b` 成立的前提是一侧为 `\w`（[A-Za-z0-9_]），而中日韩字符不属于 `\w`。
 * 因此 `\b录用\b` 在「建议录用」中永远匹配不上 —— 中文审稿结论、
 * 中文评分（「评分：8」）全部被当成 neutral / 无评分，
 * 人类介入断点的 reason 只剩泛化的「Wait for expert guidance」，
 * 审稿人分歧这条关键信号被静默丢弃（产品本身输出中文审稿意见）。
 */

describe("中文审稿结论识别", () => {
  it("录用 vs 拒稿 判定为分歧", () => {
    expect(hasPeerReviewScoreGap("本文建议录用，创新性尚可。", "建议拒稿，实验不充分。")).toBe(true)
  })

  it("小修 vs 大修 判定为分歧", () => {
    expect(hasPeerReviewScoreGap("建议接收，做小修即可。", "建议大修后重投。")).toBe(true)
  })

  it("同为录用时不误报分歧", () => {
    expect(hasPeerReviewScoreGap("建议录用，小修。", "建议接收，补充实验。")).toBe(false)
  })

  it("「不予接收」应判为拒稿，而不是既录用又拒稿的中立态", () => {
    expect(hasPeerReviewScoreGap("不予接收。", "建议录用。")).toBe(true)
  })

  it("「不予录用」同理", () => {
    expect(hasPeerReviewScoreGap("决定不予录用。", "weak accept, 可以发表。")).toBe(true)
  })
})

describe("中文评分提取", () => {
  it("「评分：」「总分」两种写法都能取到数值", () => {
    expect(hasPeerReviewScoreGap("评分：9 分，方法扎实。", "评分：3 分，难以复现。")).toBe(true)
  })

  it("总分写法", () => {
    expect(hasPeerReviewScoreGap("总分 8，推荐。", "总分 4，仅供参考。")).toBe(true)
  })

  it("分差小于阈值时不触发", () => {
    expect(hasPeerReviewScoreGap("评分：7", "评分：6")).toBe(false)
  })
})

describe("跨量纲评分归一", () => {
  it("85/100 与 8/10 是同一水平，不应判为分歧", () => {
    // 归一后 8.5 vs 8.0，差 0.5
    expect(hasPeerReviewScoreGap("Score: 85/100", "Rating: 8/10")).toBe(false)
  })

  it("同一量纲内的真实大分差仍然触发", () => {
    expect(hasPeerReviewScoreGap("Score: 9/10", "Score: 3/10")).toBe(true)
  })

  it("百分制内的大分差不被误判成 0 分差", () => {
    expect(hasPeerReviewScoreGap("Overall: 90/100", "Overall: 40/100")).toBe(true)
  })
})

describe("英文路径不回归", () => {
  it("原有英文用例保持", () => {
    expect(hasPeerReviewScoreGap("Overall: Accept, solid contribution", "Recommendation: Reject")).toBe(
      true
    )
    expect(hasPeerReviewScoreGap("Weak accept with minor fixes", "Weak accept too")).toBe(false)
    expect(hasPeerReviewScoreGap("Score: 8/10 methodology sound", "Rating: 3/10 not convincing")).toBe(
      true
    )
  })

  it("accepted / rejection 这类变形不产生误报", () => {
    // 旧实现用 (?![A-Za-z]) 之后仍不能把 accepted 当成 accept
    expect(hasPeerReviewScoreGap("The paper was accepted with minor changes", "nothing here")).toBe(false)
  })
})

describe("断点触发口径", () => {
  it("默认强制在领域主席前断点", () => {
    expect(shouldTriggerPeerReviewBreakpoint("建议录用", "建议录用")).toBe(true)
  })

  it("显式关闭强制后按分歧判定", () => {
    const opt = { forceBeforeAreaChair: false }
    expect(shouldTriggerPeerReviewBreakpoint("建议录用", "建议拒稿", opt)).toBe(true)
    expect(shouldTriggerPeerReviewBreakpoint("建议录用", "建议接收", opt)).toBe(false)
  })
})
