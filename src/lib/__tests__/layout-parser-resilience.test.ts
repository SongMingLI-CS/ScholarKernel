import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { parseLayoutAwareDocument, setExternalLayoutParser } from "../document/layout-aware-parser"

const SAMPLE = Buffer.from("# Attention Is All You Need\n\nWe propose the Transformer.\n", "utf8")
const ENV_KEYS = ["LAYOUT_PARSER_URL", "LAYOUT_PARSER_API_KEY", "LAYOUT_PARSER_TIMEOUT_MS"] as const

let envSnapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  envSnapshot = {}
  for (const key of ENV_KEYS) {
    envSnapshot[key] = process.env[key]
    delete process.env[key]
  }
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  setExternalLayoutParser(null)
  for (const key of ENV_KEYS) {
    const prev = envSnapshot[key]
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("外部版面解析器的失败边界", () => {
  it("注入的解析器抛错时降级到本地解析，而不是让整次摄取失败", async () => {
    setExternalLayoutParser(() => {
      throw new Error("marker crashed")
    })

    const result = await parseLayoutAwareDocument({ buffer: SAMPLE, filename: "paper.md" })

    expect(result.parser).toBe("local")
    expect(result.text).toContain("Transformer")
    expect(result.warnings.some((w) => w.includes("ExternalParserUnavailable"))).toBe(true)
  })

  it("注入的解析器返回 null 时走本地解析", async () => {
    setExternalLayoutParser(async () => null)
    const result = await parseLayoutAwareDocument({ buffer: SAMPLE, filename: "paper.md" })
    expect(result.parser).toBe("local")
  })

  it("注入的解析器超时后降级到本地解析", async () => {
    setExternalLayoutParser(() => new Promise(() => {}))
    process.env.LAYOUT_PARSER_TIMEOUT_MS = "40"

    const started = Date.now()
    const result = await parseLayoutAwareDocument({ buffer: SAMPLE, filename: "paper.md" })
    const elapsed = Date.now() - started

    expect(result.parser).toBe("local")
    expect(result.text).toContain("Transformer")
    expect(elapsed).toBeLessThan(2000)
  })

  it("HTTP 解析器挂起时按超时放弃，不把上传请求一起拖死", async () => {
    process.env.LAYOUT_PARSER_URL = "https://parser.invalid/layout"
    process.env.LAYOUT_PARSER_TIMEOUT_MS = "40"
    vi.stubGlobal(
      "fetch",
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          const signal = init?.signal
          if (signal) {
            signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
          }
        })
    )

    const started = Date.now()
    const result = await parseLayoutAwareDocument({ buffer: SAMPLE, filename: "paper.md" })
    const elapsed = Date.now() - started

    expect(result.parser).toBe("local")
    expect(result.text).toContain("Transformer")
    expect(elapsed).toBeLessThan(2000)
  })

  it("HTTP 解析器返回非 JSON 时降级，而不是抛解析异常", async () => {
    process.env.LAYOUT_PARSER_URL = "https://parser.invalid/layout"
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>gateway error</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        })
    )

    const result = await parseLayoutAwareDocument({ buffer: SAMPLE, filename: "paper.md" })
    expect(result.parser).toBe("local")
    expect(result.text).toContain("Transformer")
  })
})
