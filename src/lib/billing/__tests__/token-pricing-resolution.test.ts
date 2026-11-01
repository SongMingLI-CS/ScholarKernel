import { describe, expect, it } from "vitest"

import {
  calculateTokenCost,
  estimateSearchTokenUsage,
  normalizeModelKey,
  resolveModelPricing,
} from "../token-pricing"

/**
 * 定价解析必须「最长模式优先」。
 *
 * 现实现对 MODEL_PRICING 做 Object.entries 顺序遍历 + includes 子串匹配，
 * 而表中「gpt-4o」排在「gpt-4o-mini」之前、「gpt-4.1」排在「gpt-4.1-mini」之前。
 * 于是任何带日期后缀的 mini 模型（OpenAI 真实返回的 model id 就带后缀）
 * 都会先命中全尺寸版本的价格。
 */
describe("resolveModelPricing 子串匹配顺序", () => {
  it("带日期后缀的 gpt-4o-mini 按 mini 价计费", () => {
    // 真实 API 返回的 model 字段形如 gpt-4o-mini-2024-07-18
    expect(resolveModelPricing("gpt-4o-mini-2024-07-18")).toEqual({
      inputPerM: 0.15,
      outputPerM: 0.6,
    })
  })

  it("带日期后缀的 gpt-4.1-mini 按 mini 价计费", () => {
    expect(resolveModelPricing("gpt-4.1-mini-2025-04-14")).toEqual({
      inputPerM: 0.4,
      outputPerM: 1.6,
    })
  })

  it("带 provider 前缀与大小写混杂时仍然取 mini 价", () => {
    expect(resolveModelPricing("openai/GPT-4o-MINI-2024-07-18")).toEqual({
      inputPerM: 0.15,
      outputPerM: 0.6,
    })
  })

  it("精确命中不受排序影响", () => {
    expect(resolveModelPricing("gpt-4o-mini")).toEqual({ inputPerM: 0.15, outputPerM: 0.6 })
    expect(resolveModelPricing("gpt-4o")).toEqual({ inputPerM: 2.5, outputPerM: 10 })
  })

  it("未知模型仍回落到默认价", () => {
    expect(resolveModelPricing("some-unknown-model-v1")).toEqual({ inputPerM: 1, outputPerM: 2 })
  })

  it("原型链上的键不当作模型名（constructor / toString）", () => {
    // 旧实现用 `if (MODEL_PRICING[key])`，Object 构造函数是 truthy，
    // 会把它当成 ModelPricing 返回，下游 pricing.inputPerM === undefined → 费用 NaN
    expect(resolveModelPricing("constructor")).toEqual({ inputPerM: 1, outputPerM: 2 })
    expect(resolveModelPricing("toString")).toEqual({ inputPerM: 1, outputPerM: 2 })
    expect(Number.isFinite(calculateTokenCost("constructor", 1000, 1000))).toBe(true)
  })

  it("百万 token 的计费差额可量化（旧实现高估 16.7 倍）", () => {
    // mini：0.15 + 0.6 = 0.75；全尺寸：2.5 + 10 = 12.5
    expect(calculateTokenCost("gpt-4o-mini-2024-07-18", 1_000_000, 1_000_000)).toBeCloseTo(0.75, 8)
  })

  it("normalizeModelKey 只剥掉第一段 provider 前缀", () => {
    expect(normalizeModelKey("openai/gpt-4o-mini")).toBe("gpt-4o-mini")
    expect(normalizeModelKey("  DeepSeek-Chat  ")).toBe("deepseek-chat")
  })
})

describe("estimateSearchTokenUsage 边界", () => {
  it("负字符数不应抛 RangeError", () => {
    // 旧实现 String.repeat(-1) 直接抛 RangeError
    expect(() => estimateSearchTokenUsage("query", -100)).not.toThrow()
    expect(estimateSearchTokenUsage("query", -100)).toBeGreaterThanOrEqual(2000)
  })

  it("非有限字符数按 0 处理", () => {
    expect(() => estimateSearchTokenUsage("query", Number.POSITIVE_INFINITY)).not.toThrow()
    expect(estimateSearchTokenUsage("query", Number.NaN)).toBeGreaterThanOrEqual(2000)
  })

  it("字符数到 token 的换算仍是 4:1", () => {
    // base 2000 + query 1 (5 字符 / 4 向上取整 = 2) + 400 字符 / 4 = 100
    expect(estimateSearchTokenUsage("query", 400)).toBe(2000 + 2 + 100)
  })

  it("大结果集不构造等长字符串（只做算术）", () => {
    // 旧实现会为 5,000,000 字符分配一个 5MB 字符串
    const tokens = estimateSearchTokenUsage("q", 5_000_000)
    expect(tokens).toBe(2000 + 1 + 1_250_000)
  })
})
