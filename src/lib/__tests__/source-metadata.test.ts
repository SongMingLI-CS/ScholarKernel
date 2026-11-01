import { describe, expect, it } from "vitest"

import { MAX_SOURCES_PER_MESSAGE, normalizeSources, sanitizeSourceUrl } from "../source-metadata"

/**
 * 来源 url 最终会进 `<a href>`，所以判定必须按**协议白名单**做（http/https），
 * 而不是列举 `javascript:`、`vbscript:` 这类黑名单 —— 黑名单永远漏。
 * 下面每条断言都对应一个真实出现过的绕过手法。
 */
describe("sanitizeSourceUrl", () => {
  it("保留 http / https", () => {
    expect(sanitizeSourceUrl("https://example.com/a?b=1#c")).toBe("https://example.com/a?b=1#c")
    expect(sanitizeSourceUrl("http://localhost:3000/x")).toBe("http://localhost:3000/x")
    expect(sanitizeSourceUrl("HTTPS://EXAMPLE.COM/A")).toBe("HTTPS://EXAMPLE.COM/A")
  })

  it("丢弃 javascript: 协议", () => {
    expect(sanitizeSourceUrl("javascript:alert(1)")).toBeNull()
  })

  it("丢弃大小写混写的协议", () => {
    expect(sanitizeSourceUrl("JaVaScRiPt:alert(1)")).toBeNull()
  })

  it("丢弃用制表符/换行拆开协议名的写法", () => {
    // 浏览器解析 href 时会忽略这些字符，只看字符串前缀的过滤会被绕过
    expect(sanitizeSourceUrl("java\tscript:alert(1)")).toBeNull()
    expect(sanitizeSourceUrl("java\nscript:alert(1)")).toBeNull()
    expect(sanitizeSourceUrl(" javascript:alert(1)")).toBeNull()
  })

  it("丢弃 data: / vbscript: / file:", () => {
    expect(sanitizeSourceUrl("data:text/html,<script>alert(1)</script>")).toBeNull()
    expect(sanitizeSourceUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull()
    expect(sanitizeSourceUrl("vbscript:msgbox(1)")).toBeNull()
    expect(sanitizeSourceUrl("file:///etc/passwd")).toBeNull()
  })

  it("丢弃相对地址与裸域名（来源必须是绝对地址）", () => {
    expect(sanitizeSourceUrl("/x/a")).toBeNull()
    expect(sanitizeSourceUrl("example.com/a")).toBeNull()
    expect(sanitizeSourceUrl("//example.com/a")).toBeNull()
  })

  it("丢弃缺少 host 的 https://", () => {
    expect(sanitizeSourceUrl("https://")).toBeNull()
  })

  it("丢弃非字符串与空串", () => {
    expect(sanitizeSourceUrl(undefined)).toBeNull()
    expect(sanitizeSourceUrl(null)).toBeNull()
    expect(sanitizeSourceUrl(123)).toBeNull()
    expect(sanitizeSourceUrl("   ")).toBeNull()
  })
})

describe("normalizeSources", () => {
  it("非数组直接返回空", () => {
    expect(normalizeSources(undefined)).toEqual([])
    expect(normalizeSources(null)).toEqual([])
    expect(normalizeSources("x")).toEqual([])
    expect(normalizeSources({})).toEqual([])
  })

  it("跳过畸形条目，不抛错", () => {
    expect(normalizeSources([null, "x", 1, [], { title: "a" }, { url: "https://a" }])).toEqual([])
  })

  it("丢弃没有标题的条目", () => {
    expect(normalizeSources([{ title: "   ", url: "https://a.com" }])).toEqual([])
  })

  it("只保留已知字段，不把任意大字段带进 metadata", () => {
    const [s] = normalizeSources([
      {
        title: " Paper ",
        url: " https://a.com/1 ",
        snippet: "abs",
        publishedAt: "2024",
        source_id: "3",
        blob: "x".repeat(1000),
      },
    ])
    expect(s).toEqual({ title: "Paper", url: "https://a.com/1", snippet: "abs", publishedAt: "2024", source_id: "3" })
  })

  it("混合输入里只留下安全条目", () => {
    const out = normalizeSources([
      { title: "ok", url: "https://a.com" },
      { title: "bad", url: "javascript:alert(1)" },
      { title: "also-ok", url: "http://b.com" },
    ])
    expect(out.map((s) => s.url)).toEqual(["https://a.com", "http://b.com"])
  })

  it("超过上限时截断", () => {
    const many = Array.from({ length: MAX_SOURCES_PER_MESSAGE + 25 }, (_, i) => ({
      title: `t${i}`,
      url: `https://a.com/${i}`,
    }))
    expect(normalizeSources(many)).toHaveLength(MAX_SOURCES_PER_MESSAGE)
  })
})
