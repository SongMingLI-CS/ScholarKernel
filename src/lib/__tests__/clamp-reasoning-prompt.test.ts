import { describe, expect, it } from "vitest"

import { clampReasoningPrompt } from "../tools/academic-search-strategy"

/**
 * 函数名是 clamp，但它并不保证结果不超过 limit。
 *
 * 两条分支都会溢出：
 * 1. 没有 JSON 标记时，直接 `slice(0, lim)` 再拼一段截断提示 → 超出一个提示的长度；
 * 2. 有标记时，`jsonBudget = Math.max(200, reserved)` 会在剩余预算不足 200 时
 *    硬塞 200 字符的 JSON 片段 → 最多超出 136 字符。
 *
 * 这个 limit 来自 `inference.contextLimit`，作用就是压进模型上下文窗口，
 * 「近似不超」等于把溢出风险推给上游 400/截断。
 */

const MARKER = "已完成子任务结果（JSON）："

function longText(withMarker: boolean): string {
  const head = `【当前系统配置】\n用户需求：请综述图神经网络推荐系统。\n${"背景说明行。\n".repeat(60)}`
  if (!withMarker) return head + "尾部补充说明".repeat(200)
  return head + MARKER + "\n" + JSON.stringify([{ id: "a", blob: "x".repeat(4000) }])
}

describe("clampReasoningPrompt 硬上限", () => {
  it("没有 JSON 标记时结果不超过 limit", () => {
    const text = longText(false)
    const lim = 400
    expect(text.length).toBeGreaterThan(lim)
    expect(clampReasoningPrompt(text, lim).length).toBeLessThanOrEqual(lim)
  })

  it("JSON 标记后预算不足时也不超过 limit", () => {
    const text = longText(true)
    const markerIdx = text.indexOf(MARKER)
    // 留出的空间刚好只够 head + marker，剩余预算远小于 200
    const lim = markerIdx + MARKER.length + 20
    expect(clampReasoningPrompt(text, lim).length).toBeLessThanOrEqual(lim)
  })

  it("预算充足时保留 head 全文并截断 JSON", () => {
    const text = longText(true)
    const lim = 1200
    const out = clampReasoningPrompt(text, lim)
    expect(out.length).toBeLessThanOrEqual(lim)
    expect(out).toContain(MARKER)
    expect(out).toContain("用户需求：")
    expect(out).toContain("subtask JSON truncated")
  })

  it("未超限时原样返回", () => {
    const text = "短文"
    expect(clampReasoningPrompt(text, 1000)).toBe(text)
  })

  it("limit 非有限值或为 0 时不截断", () => {
    const text = longText(false)
    expect(clampReasoningPrompt(text, undefined)).toBe(text)
    expect(clampReasoningPrompt(text, 0)).toBe(text)
    expect(clampReasoningPrompt(text, Number.NaN)).toBe(text)
  })
})
