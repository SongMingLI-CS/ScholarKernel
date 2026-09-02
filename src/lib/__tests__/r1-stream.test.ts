import { describe, expect, it } from "vitest"

import {
  R1_THINKING_CLOSE_TAG,
  R1_THINKING_OPEN_TAG,
  createR1StreamParser,
  parseR1StreamText,
  stripRedactedThinking,
} from "@/lib/r1-stream-parser"

describe("r1-stream-parser", () => {
  it("routes text before open tag to finalResponse and inside to thinkingText", () => {
    const raw = `前言${R1_THINKING_OPEN_TAG}推理过程${R1_THINKING_CLOSE_TAG}结语`
    const parsed = parseR1StreamText(raw)
    expect(parsed.finalResponse).toBe("前言结语")
    expect(parsed.thinkingText).toBe("推理过程")
    expect(parsed.thinkingComplete).toBe(true)
  })

  it("handles stream with only thinking block", () => {
    const raw = `${R1_THINKING_OPEN_TAG}纯思考${R1_THINKING_CLOSE_TAG}`
    const parsed = parseR1StreamText(raw)
    expect(parsed.thinkingText).toBe("纯思考")
    expect(parsed.finalResponse).toBe("")
    expect(parsed.thinkingComplete).toBe(true)
  })

  it("handles stream with only final response (no thinking tags)", () => {
    const parsed = parseR1StreamText("直接回答用户")
    expect(parsed.finalResponse).toBe("直接回答用户")
    expect(parsed.thinkingText).toBe("")
    expect(parsed.thinkingComplete).toBe(false)
  })

  it("parses extreme fragmented open/close tag chunks without leakage", () => {
    const parser = createR1StreamParser()
    const chunks = [
      "<redacted_thin",
      "king>",
      "步骤A",
      "</redacted_thi",
      "nking>",
      "答案",
    ]
    let last = parser.snapshot()
    for (const c of chunks) {
      last = parser.append(c)
    }
    const final = parser.flush()
    expect(final.thinkingText).toBe("步骤A")
    expect(final.finalResponse).toBe("答案")
    expect(final.thinkingComplete).toBe(true)
    expect(last.track).toBe("response")
  })

  it("parses fragmented close tag across network congestion", () => {
    const parser = createR1StreamParser()
    const open = R1_THINKING_OPEN_TAG
    const chunks = [
      open.slice(0, 4),
      open.slice(4),
      "分析中",
      "</redacted_thi",
      "nking>",
      "报告正文",
    ]
    for (const c of chunks) parser.append(c)
    const final = parser.flush()
    expect(final.thinkingText).toBe("分析中")
    expect(final.finalResponse).toBe("报告正文")
    expect(final.thinkingComplete).toBe(true)
  })

  it("never misroutes partial tag prefix as content", () => {
    const parser = createR1StreamParser()
    parser.append("前缀<redacted_thin")
    let snap = parser.snapshot()
    expect(snap.finalResponse).toBe("前缀")
    expect(snap.thinkingText).toBe("")

    snap = parser.append("king>思考片段")
    expect(snap.thinkingText).toBe("思考片段")
    expect(snap.finalResponse).toBe("前缀")
    expect(snap.track).toBe("thinking")
  })

  it("signals justCompletedThinking on close tag arrival", () => {
    const parser = createR1StreamParser()
    parser.append(`${R1_THINKING_OPEN_TAG}链`)
    const hit = parser.append(`${R1_THINKING_CLOSE_TAG}终`)
    expect(hit.justCompletedThinking).toBe(true)
    expect(hit.thinkingText).toBe("链")
    expect(hit.finalResponse).toBe("终")
  })

  it("incremental append matches one-shot parse", () => {
    const raw = `A${R1_THINKING_OPEN_TAG}B${R1_THINKING_CLOSE_TAG}C`
    const oneShot = parseR1StreamText(raw)

    const parser = createR1StreamParser()
    for (const ch of raw) parser.append(ch)
    const incremental = parser.flush()

    expect(incremental).toEqual(oneShot)
  })

  it("stripRedactedThinking removes blocks and residual tag fragments", () => {
    const dirty = `可见${R1_THINKING_OPEN_TAG}隐藏思考${R1_THINKING_CLOSE_TAG}正文<redacted_thin`
    expect(stripRedactedThinking(dirty)).toBe("可见正文")
  })

  it("stripRedactedThinking removes unclosed thinking region at stream end", () => {
    const dirty = `前言${R1_THINKING_OPEN_TAG}未完成思考`
    expect(stripRedactedThinking(dirty)).toBe("前言")
  })
})
