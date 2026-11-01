import { describe, expect, it } from "vitest"

import { resolveSafeCallbackPath } from "../api-fetch"

/**
 * 登录成功后会 `router.replace(callbackUrl)`。原来的校验是
 * `raw.startsWith("/") && !raw.startsWith("//")` —— 挡得住 `//evil.com`，
 * 但 WHATWG URL 解析把反斜杠与制表符也当作路径分隔符：
 *
 *   new URL("/\\evil.com",  origin).origin === "https://evil.com"
 *   new URL("/\\/evil.com", origin).origin === "https://evil.com"
 *   new URL("/\t/evil.com", origin).origin === "https://evil.com"
 *
 * 三个变体都能通过 startsWith 检查，登录后被送到站外 —— 钓鱼的经典落点。
 */
const ORIGIN = "https://app.example.com"

describe("登录回跳目标必须是站内路径", () => {
  it("保留正常的站内路径", () => {
    expect(resolveSafeCallbackPath("/dashboard", ORIGIN)).toBe("/dashboard")
    expect(resolveSafeCallbackPath("/workspace/abc?tab=1#s", ORIGIN)).toBe("/workspace/abc?tab=1#s")
  })

  it("拒绝协议相对地址", () => {
    expect(resolveSafeCallbackPath("//evil.com", ORIGIN)).toBe("/")
  })

  it("拒绝用反斜杠/制表符伪装的站外地址", () => {
    expect(resolveSafeCallbackPath("/\\evil.com", ORIGIN)).toBe("/")
    expect(resolveSafeCallbackPath("/\\/evil.com", ORIGIN)).toBe("/")
    expect(resolveSafeCallbackPath("/\t/evil.com", ORIGIN)).toBe("/")
  })

  it("拒绝绝对地址与非 http 协议", () => {
    expect(resolveSafeCallbackPath("https://evil.com/x", ORIGIN)).toBe("/")
    expect(resolveSafeCallbackPath("http://evil.com", ORIGIN)).toBe("/")
    expect(resolveSafeCallbackPath("javascript:alert(1)", ORIGIN)).toBe("/")
  })

  it("拒绝解析后仍会指向站外的路径", () => {
    // 路径归一化之后变成 "//evil.com"，直接交给 router.replace 仍是协议相对地址
    expect(resolveSafeCallbackPath("/..//evil.com", ORIGIN)).toBe("/")
  })

  it("缺失或非法输入回落到根路径", () => {
    expect(resolveSafeCallbackPath(null, ORIGIN)).toBe("/")
    expect(resolveSafeCallbackPath(undefined, ORIGIN)).toBe("/")
    expect(resolveSafeCallbackPath("", ORIGIN)).toBe("/")
  })
})
