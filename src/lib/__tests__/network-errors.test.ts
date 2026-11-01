import { afterEach, describe, expect, it, vi } from "vitest"

import { classifyFetchError, isLikelyCorsBlocked } from "../network-errors"

/**
 * 分类顺序决定用户看到什么。
 *
 * 浏览器在**断网**时抛的正是 `TypeError: Failed to fetch`，和跨域被拦时的
 * 报错字符串完全一致 —— 唯一可靠的区分依据是 `navigator.onLine`。
 * 现实现先匹配字符串、最后才看 onLine，于是断网会被判成 CORS，
 * 弹出一个「请检查跨域配置」的帮助弹窗（models-panel / use-chat-send 都接了这条路径）。
 */

function setOnline(value: boolean) {
  vi.stubGlobal("navigator", { onLine: value })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("classifyFetchError 离线优先", () => {
  it("断网时的 Failed to fetch 判为 offline，不是 cors", () => {
    setOnline(false)
    expect(classifyFetchError(new TypeError("Failed to fetch")).kind).toBe("offline")
  })

  it("断网时 NetworkError 也判为 offline", () => {
    setOnline(false)
    expect(classifyFetchError(new TypeError("NetworkError when attempting to fetch resource.")).kind).toBe(
      "offline"
    )
  })

  it("断网时 Load failed 也判为 offline", () => {
    setOnline(false)
    expect(classifyFetchError(new Error("Load failed")).kind).toBe("offline")
  })

  it("在线时 Failed to fetch 仍判为 cors", () => {
    setOnline(true)
    expect(classifyFetchError(new TypeError("Failed to fetch")).kind).toBe("cors")
  })

  it("在线时的三种 CORS 文案都能识别", () => {
    setOnline(true)
    expect(classifyFetchError(new Error("Failed to fetch")).kind).toBe("cors")
    expect(classifyFetchError(new Error("NetworkError when attempting to fetch resource.")).kind).toBe(
      "cors"
    )
    expect(classifyFetchError(new Error("Load failed")).kind).toBe("cors")
  })

  it("断网但错误文案无法识别时仍判 offline", () => {
    setOnline(false)
    expect(classifyFetchError(new Error("net::ERR_INTERNET_DISCONNECTED")).kind).toBe("offline")
  })

  it("在线且文案无法识别时判 unknown", () => {
    setOnline(true)
    expect(classifyFetchError(new Error("socket hang up")).kind).toBe("unknown")
  })
})

describe("classifyFetchError 输入归一", () => {
  it("字符串错误保留原文", () => {
    setOnline(true)
    expect(classifyFetchError("Load failed")).toEqual({ kind: "cors", message: "Load failed" })
  })

  it("非 Error 非字符串退化为 UnknownError", () => {
    setOnline(true)
    expect(classifyFetchError(null)).toEqual({ kind: "unknown", message: "UnknownError" })
    expect(classifyFetchError({ code: 1 })).toEqual({ kind: "unknown", message: "UnknownError" })
  })

  it("没有 navigator（SSR / 边缘运行时）时不崩溃", () => {
    vi.stubGlobal("navigator", undefined)
    expect(() => classifyFetchError(new Error("Failed to fetch"))).not.toThrow()
    expect(classifyFetchError(new Error("Failed to fetch")).kind).toBe("cors")
  })
})

describe("isLikelyCorsBlocked", () => {
  it("断网时不再返回 true（不弹 CORS 帮助）", () => {
    setOnline(false)
    expect(isLikelyCorsBlocked(new TypeError("Failed to fetch"))).toBe(false)
  })

  it("在线且跨域被拦时返回 true", () => {
    setOnline(true)
    expect(isLikelyCorsBlocked(new TypeError("Failed to fetch"))).toBe(true)
  })
})
