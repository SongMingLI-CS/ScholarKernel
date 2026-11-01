import { describe, expect, it } from "vitest"

import { buildConversationPrintHtml } from "../export-utils"

type Msg = Parameters<typeof buildConversationPrintHtml>[1][number]

function msg(content: string, extra: Partial<Msg> = {}): Msg {
  return { role: "assistant", content, ...extra } as Msg
}

describe("导出 HTML 的内容安全", () => {
  it("不把 markdown 里的 script 标签带进导出结果", () => {
    const html = buildConversationPrintHtml("t", [msg("正文\n\n<script>alert(1)</script>")])
    expect(html).not.toContain("<script")
    expect(html.toLowerCase()).not.toContain("alert(1)</script>")
  })

  it("不把事件属性带进导出结果", () => {
    // 导出 PDF 时这段 HTML 会经 innerHTML 插入真实 DOM，<img onerror> 会真的执行
    const html = buildConversationPrintHtml("t", [
      msg('<img src="x" onerror="window.__pwned=1">'),
    ])
    expect(html).not.toContain("onerror")
  })

  it("不保留 javascript: 协议的引用链接", () => {
    const html = buildConversationPrintHtml("t", [
      msg("正文", { sources: [{ url: "javascript:alert(1)", title: "bad" }] } as Partial<Msg>),
    ])
    expect(html).not.toContain("javascript:")
    // 被拒的链接仍应保留标题文本，而不是整条消失
    expect(html).toContain("bad")
  })

  it("保留正常的 markdown 结构与 http 链接", () => {
    const html = buildConversationPrintHtml("t", [
      msg("**重点** 内容", {
        sources: [{ url: "https://arxiv.org/abs/1", title: "Paper" }],
      } as Partial<Msg>),
    ])
    expect(html).toContain("<strong>重点</strong>")
    expect(html).toContain("https://arxiv.org/abs/1")
  })

  it("转义标题里的 HTML", () => {
    const html = buildConversationPrintHtml('<img src=x onerror="alert(1)">', [msg("body")])
    expect(html).not.toContain('onerror="alert(1)"')
  })
})
