import { describe, expect, it } from "vitest"

import { sanitizeExportHtml } from "../export-utils"

/**
 * `sanitizeExportHtml` 是字符串级黑名单，黑名单天然怕编码。
 *
 * 浏览器在解析 `href` 之前会先解 HTML 实体、丢弃协议名里的空白字符，
 * 所以 `&#106;avascript:` / `java\tscript:` 与 `javascript:` 完全等价；
 * 而 `<svg/onload=...>` 在 HTML 里与 `<svg onload=...>` 解析结果相同。
 * 三类写法都能绕过「只认字面量 javascript: + 必须空格开头的事件属性」的旧规则。
 */

describe("协议绕过", () => {
  it("实体编码的 javascript: 必须挡掉", () => {
    const out = sanitizeExportHtml('<a href="&#106;avascript:alert(1)">x</a>')
    expect(out).not.toContain("javascript")
    expect(out).not.toContain("&#106;")
  })

  it("十六进制实体编码同样挡掉", () => {
    const out = sanitizeExportHtml('<a href="&#x6a;avascript:alert(1)">x</a>')
    expect(out).not.toContain("&#x6a;")
  })

  it("协议名里夹空白（tab / 换行）挡掉", () => {
    expect(sanitizeExportHtml('<a href="java\tscript:alert(1)">x</a>')).not.toContain("alert(1)")
    expect(sanitizeExportHtml('<a href="java\nscript:alert(1)">x</a>')).not.toContain("alert(1)")
  })

  it("vbscript 与 data:text/html 挡掉", () => {
    expect(sanitizeExportHtml('<a href="vbscript:msgbox(1)">x</a>')).not.toContain("vbscript")
    expect(sanitizeExportHtml('<img src="data:text/html,<script>alert(1)</script>">')).not.toContain(
      "data:text/html"
    )
  })

  it("正常 http(s) 与相对链接保留", () => {
    expect(sanitizeExportHtml('<a href="https://example.com/a">x</a>')).toContain(
      'href="https://example.com/a"'
    )
    expect(sanitizeExportHtml('<a href="/docs/a">x</a>')).toContain('href="/docs/a"')
    expect(sanitizeExportHtml('<a href="#sec1">x</a>')).toContain('href="#sec1"')
  })

  it("data:image 内联图保留（不含 svg）", () => {
    const png = '<img src="data:image/png;base64,iVBORw0KGgo=">'
    expect(sanitizeExportHtml(png)).toContain("data:image/png")
    const svg = '<img src="data:image/svg+xml,<svg onload=alert(1)/>">'
    expect(sanitizeExportHtml(svg)).not.toContain("data:image/svg")
  })
})

describe("事件属性绕过", () => {
  it("标签名后紧跟斜杠的事件属性挡掉", () => {
    const out = sanitizeExportHtml("<svg/onload=alert(1)></svg>")
    expect(out).not.toContain("onload")
    expect(out).not.toContain("alert(1)")
  })

  it("引号紧跟事件属性挡掉", () => {
    const out = sanitizeExportHtml('<a href="/x"onclick="alert(1)">x</a>')
    expect(out).not.toContain("onclick")
  })

  it("大小写混写挡掉", () => {
    expect(sanitizeExportHtml("<body ONERROR=alert(1)>")).not.toContain("ONERROR")
  })

  it("正文里出现的普通英文不被误删", () => {
    const out = sanitizeExportHtml("<p>this is based on error rate and online status</p>")
    expect(out).toContain("based on error rate")
    expect(out).toContain("online status")
  })
})
