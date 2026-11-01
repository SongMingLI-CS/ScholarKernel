import { describe, expect, it, vi } from "vitest"

import {
  extractUsageCounts,
  recordLlmUsageAsync,
  recordSearchUsageAsync,
  type RecordTokenUsageInput,
} from "../token-usage-bridge"

/**
 * 计费支路的两个关键不变量：
 * 1. 只要上游报了 token，就必须记账 —— 否则用户白嫖、成本失控；
 * 2. 上游没给 input/output 拆分时，也不能当作「零 token」直接丢弃。
 *
 * AI SDK 的 LanguageModelUsage 三个计数字段全部是 `number | undefined`，
 * 部分网关（尤其是 OpenAI 兼容代理）只回 total，不拆分。
 */

function recorder() {
  const calls: RecordTokenUsageInput[] = []
  return {
    calls,
    recordTokenUsage: (input: RecordTokenUsageInput) => {
      calls.push(input)
    },
  }
}

describe("extractUsageCounts", () => {
  it("input/output 齐全时原样返回并向下取整", () => {
    expect(extractUsageCounts({ inputTokens: 10.9, outputTokens: 20.2 })).toEqual({
      inputTokens: 10,
      outputTokens: 20,
    })
  })

  it("负数与非有限值收敛为 0", () => {
    expect(extractUsageCounts({ inputTokens: -5, outputTokens: Number.NaN })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    })
  })

  it("只有 totalTokens 时不丢计数", () => {
    const counts = extractUsageCounts({ totalTokens: 1200 })
    expect(counts.inputTokens + counts.outputTokens).toBe(1200)
  })

  it("input 缺失但 output 存在时，用 total 补齐 input", () => {
    const counts = extractUsageCounts({ outputTokens: 200, totalTokens: 1000 })
    expect(counts.outputTokens).toBe(200)
    expect(counts.inputTokens).toBe(800)
  })

  it("totalTokens 小于已知分解时不产生负数", () => {
    const counts = extractUsageCounts({ inputTokens: 900, outputTokens: 200, totalTokens: 1000 })
    expect(counts.inputTokens).toBe(900)
    expect(counts.outputTokens).toBe(200)
  })
})

describe("recordLlmUsageAsync", () => {
  it("只有 totalTokens 的 usage 仍然记账", () => {
    const r = recorder()
    recordLlmUsageAsync({ userId: "u1", recordTokenUsage: r.recordTokenUsage }, "deepseek-chat", {
      totalTokens: 1500,
    } as never)
    expect(r.calls).toHaveLength(1)
    expect(r.calls[0]!.inputTokens + r.calls[0]!.outputTokens).toBe(1500)
  })

  it("没有 userId 时不记账", () => {
    const r = recorder()
    recordLlmUsageAsync({ recordTokenUsage: r.recordTokenUsage }, "deepseek-chat", {
      inputTokens: 10,
      outputTokens: 10,
    } as never)
    expect(r.calls).toHaveLength(0)
  })

  it("usage 为 null 时不记账也不抛错", () => {
    const r = recorder()
    expect(() =>
      recordLlmUsageAsync({ userId: "u1", recordTokenUsage: r.recordTokenUsage }, "m", null)
    ).not.toThrow()
    expect(r.calls).toHaveLength(0)
  })

  it("记账函数同步抛错时不把异常抛回调用方", () => {
    // 计费失败不应中断已经付过费的 LLM 流
    const boom = vi.fn(() => {
      throw new Error("db down")
    })
    expect(() =>
      recordLlmUsageAsync({ userId: "u1", recordTokenUsage: boom }, "m", {
        inputTokens: 5,
        outputTokens: 5,
      } as never)
    ).not.toThrow()
    expect(boom).toHaveBeenCalledTimes(1)
  })
})

describe("recordSearchUsageAsync", () => {
  it("写入 provider 对应的 model 名且 outputTokens 为 0", () => {
    const r = recorder()
    recordSearchUsageAsync({ userId: "u1", jobId: "j1", recordTokenUsage: r.recordTokenUsage }, "serper", "q", 400)
    expect(r.calls[0]).toMatchObject({ userId: "u1", jobId: "j1", modelUsed: "serper-search", outputTokens: 0 })
    expect(r.calls[0]!.inputTokens).toBeGreaterThan(2000)
  })

  it("记账函数抛错时不冒泡", () => {
    const boom = vi.fn(() => {
      throw new Error("db down")
    })
    expect(() =>
      recordSearchUsageAsync({ userId: "u1", recordTokenUsage: boom }, "tavily", "q", 10)
    ).not.toThrow()
  })
})
