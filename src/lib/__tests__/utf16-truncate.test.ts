import { describe, expect, it } from "vitest"

import { sanitizeAgentErrorText } from "../agent-job-errors"
import { deriveConversationTitle, sanitizeExportFilename } from "../conversation-utils"
import { hasLoneSurrogate, truncateUtf16 } from "../text-truncate"
import { truncateSnippet } from "../tools/academic-search-strategy"

/**
 * 截断不能切开代理对。
 *
 * `"😀".slice(0, 31)` 的末位是高位代理 `\ud83d`，与后面被切掉的低位代理不再成对。
 * 这类字符串存进数据库后无法还原，渲染时是 `�`，`JSON.stringify` 会写成 `\ud83d`，
 * 而服务端按 UTF-8 解码会直接 400。
 */

const EMOJI = "\u{1F600}"
const LONG = EMOJI.repeat(40)

describe("truncateUtf16", () => {
  it("未超长时原样返回", () => {
    expect(truncateUtf16("abc", 10)).toBe("abc")
  })

  it("切开代理对时丢掉半个字符", () => {
    const out = truncateUtf16(LONG, 31)
    expect(hasLoneSurrogate(out)).toBe(false)
    expect(out.length).toBeLessThanOrEqual(31)
    expect(out).toBe(EMOJI.repeat(15))
  })

  it("后缀计入总长度", () => {
    const out = truncateUtf16(LONG, 31, "…")
    expect(hasLoneSurrogate(out)).toBe(false)
    expect(out.endsWith("…")).toBe(true)
    expect(out.length).toBeLessThanOrEqual(31)
  })

  it("limit 小于后缀长度时只留后缀，不越界", () => {
    expect(truncateUtf16(LONG, 1, "…")).toBe("…")
    expect(truncateUtf16(LONG, 0, "…")).toBe("")
  })

  it("孤立低位代理同样被识别（自检函数）", () => {
    expect(hasLoneSurrogate("\udc00")).toBe(true)
    expect(hasLoneSurrogate("\ud83d")).toBe(true)
    expect(hasLoneSurrogate(EMOJI)).toBe(false)
  })
})

describe("会话标题派生", () => {
  it("标题不出现孤立代理", () => {
    const title = deriveConversationTitle(LONG)
    expect(hasLoneSurrogate(title)).toBe(false)
    expect(title.endsWith("…")).toBe(true)
    expect(title.length).toBeLessThanOrEqual(32)
  })

  it("纯英文标题行为不变", () => {
    expect(deriveConversationTitle("hello world")).toBe("hello world")
    const long = deriveConversationTitle("a".repeat(50))
    expect(long).toBe(`${"a".repeat(31)}…`)
  })
})

describe("检索摘要截断", () => {
  it("snippet 截断不切代理对", () => {
    // 481 是奇数：切片正好落在表情的中间
    const out = truncateSnippet(`a${EMOJI.repeat(300)}`, 481)
    expect(hasLoneSurrogate(out)).toBe(false)
    expect(out.endsWith("…")).toBe(true)
  })
})

describe("错误文本截断", () => {
  it("超长错误信息截断后不出现孤立代理", () => {
    const out = sanitizeAgentErrorText(EMOJI.repeat(3000), 4000)
    expect(hasLoneSurrogate(out)).toBe(false)
    expect(out.endsWith("…")).toBe(true)
  })

  it("脱敏仍然生效", () => {
    const out = sanitizeAgentErrorText(`boom ${EMOJI.repeat(3000)} sk-proj-abcdefgh12345678`)
    expect(out).not.toContain("sk-proj-abcdefgh12345678")
    expect(hasLoneSurrogate(out)).toBe(false)
  })
})

describe("导出文件名", () => {
  it("超长 emoji 标题的文件名既在长度上限内，也没有半个字符", () => {
    const name = sanitizeExportFilename(EMOJI.repeat(120))
    expect(hasLoneSurrogate(name)).toBe(false)
    expect(name.length).toBeLessThanOrEqual(104)
    expect(name.endsWith(".md")).toBe(true)
  })
})
