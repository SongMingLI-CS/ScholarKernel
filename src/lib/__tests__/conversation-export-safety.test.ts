import { describe, expect, it } from "vitest"

import { formatConversationAsMarkdown, sanitizeExportFilename } from "../conversation-utils"

/**
 * 来源标题来自搜索结果（外部内容），直接拼进 `[标题](url)` 会破坏 Markdown 链接语法：
 * `a](javascript:alert(1)) [b` 会把一条引用拆成两条，并让导出的 .md 里出现
 * 一个指向 javascript: 的链接。
 */
describe("会话导出的链接拼接", () => {
  it("来源标题里的方括号被转义，链接不会被拆开", () => {
    const md = formatConversationAsMarkdown("t", [
      {
        id: "a1",
        role: "assistant",
        content: "x",
        sources: [{ title: "a](javascript:alert(1)) [b", url: "https://ok.test/1" }],
      },
    ])
    expect(md).toContain("- [a\\](javascript:alert(1)) \\[b](https://ok.test/1)")
  })

  it("URL 里的括号与空格被编码，不会提前闭合链接", () => {
    const md = formatConversationAsMarkdown("t", [
      {
        id: "a1",
        role: "assistant",
        content: "x",
        sources: [{ title: "Paper", url: "https://ok.test/a(b) c" }],
      },
    ])
    expect(md).toContain("- [Paper](https://ok.test/a%28b%29%20c)")
  })

  it("标题里的换行被折成空格，不破坏一级标题", () => {
    const md = formatConversationAsMarkdown("第一行\n# 伪造标题", [{ id: "u1", role: "user", content: "hi" }])
    expect(md.split("\n")[0]).toBe("# 第一行 # 伪造标题")
  })

  it("来源标题里的换行被折成空格，引用条目保持单行", () => {
    const md = formatConversationAsMarkdown("t", [
      {
        id: "a1",
        role: "assistant",
        content: "x",
        sources: [{ title: "Line one\nLine two", url: "https://ok.test/1" }],
      },
    ])
    expect(md).toContain("- [Line one Line two](https://ok.test/1)")
  })
})

describe("导出文件名的边界", () => {
  it("去掉控制字符", () => {
    expect(sanitizeExportFilename("a\u0000b\u001fc")).toBe("abc.md")
  })

  it("Windows 保留设备名加前缀", () => {
    expect(sanitizeExportFilename("CON")).toBe("_CON.md")
    expect(sanitizeExportFilename("nul")).toBe("_nul.md")
    expect(sanitizeExportFilename("com1")).toBe("_com1.md")
    // 带扩展名同样被系统当作设备
    expect(sanitizeExportFilename("CON.md")).toBe("_CON.md.md")
    // 非保留名不受影响
    expect(sanitizeExportFilename("console")).toBe("console.md")
  })

  it("去掉结尾的点和空格（Windows 会静默截断）", () => {
    expect(sanitizeExportFilename("report...")).toBe("report.md")
    expect(sanitizeExportFilename("report   ")).toBe("report.md")
  })

  it("去掉开头的点，避免生成隐藏文件", () => {
    expect(sanitizeExportFilename(".env")).toBe("env.md")
  })

  it("超长标题被截断", () => {
    const name = sanitizeExportFilename("题".repeat(300))
    expect(name.length).toBeLessThanOrEqual(104)
    expect(name.endsWith(".md")).toBe(true)
  })
})
