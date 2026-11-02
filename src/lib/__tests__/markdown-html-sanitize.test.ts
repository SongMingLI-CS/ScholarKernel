import { describe, expect, it } from "vitest"
import { markdownToCanvasHtml, markdownToHtml } from "../markdown-bridge"

/**
 * SK-75: markdownToHtml / markdownToCanvasHtml 纵深防御净化。
 *
 * marked.parse 默认允许原始 HTML 透传。对话内容来自用户输入与 LLM 输出，
 * 任何调用方漏了外层净化就会让 <img onerror=...> / <script> 直接执行。
 * 修复后函数内部做基础剥离，使「默认安全」。
 */
describe("SK-75: markdownToHtml strips dangerous HTML", () => {
  it("strips <script> tags and their content", () => {
    const html = markdownToHtml("Hello <script>alert(1)</script> world")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("alert(1)")
    expect(html).toContain("Hello")
    expect(html).toContain("world")
  })

  it("strips event handler attributes (onerror, onclick, onload)", () => {
    const html = markdownToHtml('<img src="x" onerror="alert(1)">')
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("alert(1)")
  })

  it("strips <iframe> tags", () => {
    const html = markdownToHtml('<iframe src="javascript:alert(1)"></iframe>')
    expect(html).not.toContain("<iframe")
    expect(html).not.toContain("alert(1)")
  })

  it("strips javascript: URLs from href/src", () => {
    const html = markdownToHtml('<a href="javascript:alert(1)">click</a>')
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("alert(1)")
  })

  it("strips <object>/<embed>/<form> tags", () => {
    const html = markdownToHtml(
      '<form action="javascript:alert(1)"><object data="evil.swf"></object></form>'
    )
    expect(html).not.toContain("<form")
    expect(html).not.toContain("<object")
    expect(html).not.toContain("alert(1)")
  })

  it("preserves legitimate markdown (bold, code, safe links)", () => {
    const html = markdownToHtml("**bold** `code` [link](https://example.com)")
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain("<code>code</code>")
    expect(html).toContain('href="https://example.com"')
  })

  it("preserves safe URL schemes (http, https, mailto)", () => {
    const html = markdownToHtml("[email](mailto:a@b.com) [site](https://x.com)")
    expect(html).toContain('href="mailto:a@b.com"')
    expect(html).toContain('href="https://x.com"')
  })
})

describe("SK-75: markdownToCanvasHtml also strips dangerous HTML", () => {
  it("strips script tags in canvas path", () => {
    const html = markdownToCanvasHtml("Math $x^2$ <script>evil()</script>")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("evil()")
    // KaTeX output should survive
    expect(html).toContain("katex")
  })

  it("strips event handlers in canvas path", () => {
    const html = markdownToCanvasHtml('<img src="x" onerror="alert(1)">')
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("alert(1)")
  })
})
