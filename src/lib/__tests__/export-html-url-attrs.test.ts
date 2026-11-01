import { describe, expect, it } from "vitest"

import { sanitizeExportHtml } from "../export-utils"

/**
 * 导出的 .html 会被浏览器打开，`downloadConversationAsPdf` 还会把它经 `innerHTML`
 * 插进真实 DOM。净化函数按**属性名**白名单化 URL 值，之前只认
 * `href | src | xlink:href` —— 而能把 URL 送进导航的属性和它们一样多：
 *
 *   <button formaction="javascript:…">      点一下就执行
 *   <input type="image" formaction="…">     同上
 *   <form action="…">                       整段被剥离，但属性本身也该拦
 *
 * 这不是「防御性冗余」：`<button>` 不在危险标签黑名单里，事件属性也没有，
 * 于是 `formaction` 是全链路上唯一没被检查的 URL 通道。
 */

function hrefs(html: string): string[] {
  return [...html.matchAll(/(?:href|src|formaction|action)\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1] ?? "")
}

describe("导出 HTML：URL 属性的覆盖面", () => {
  it("button/formaction 的 javascript 协议被拦掉", () => {
    const out = sanitizeExportHtml('<p>x</p><button formaction="javascript:alert(1)">go</button>')
    expect(out).not.toContain("javascript:")
    expect(hrefs(out).every((u) => !/^javascript:/i.test(u))).toBe(true)
  })

  it("input/formaction 同理", () => {
    const out = sanitizeExportHtml('<input type="image" formaction="javascript:alert(1)">')
    expect(out).not.toContain("javascript:")
  })

  it("实体编码与制表符拆分同样被拦", () => {
    const out = sanitizeExportHtml(
      '<button formaction="java&#x09;script&colon;alert(1)">go</button><button formaction="java\tscript:alert(1)">x</button>'
    )
    expect(out).not.toMatch(/java[\s\S]{0,8}script:/i)
  })

  it("安全的 formaction 保留（不过度剥离）", () => {
    const out = sanitizeExportHtml('<button formaction="https://example.org/submit">go</button>')
    expect(out).toContain('formaction="https://example.org/submit"')
  })
})

describe("导出 HTML：原有 URL 属性不回归", () => {
  it("href / src 的拦截与放行保持", () => {
    const out = sanitizeExportHtml(
      '<a href="javascript:alert(1)">a</a><a href="https://ok.example/x">b</a><img src="https://ok.example/y.png">'
    )
    expect(out).not.toContain("javascript:")
    expect(out).toContain('href="https://ok.example/x"')
    expect(out).toContain('src="https://ok.example/y.png"')
  })
})
