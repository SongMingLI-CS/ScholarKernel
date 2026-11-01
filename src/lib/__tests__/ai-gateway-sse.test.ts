import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fetchMock = vi.fn()

vi.mock("@/lib/proxy-client", () => ({
  proxyAwareFetch: (...args: unknown[]) => fetchMock(...args),
}))

vi.mock("@/store/useAgentStore", () => ({
  useAgentStore: {
    getState: () => ({ runtimeKeys: {}, settings: {}, actions: {} }),
  },
}))

import { generateStream, mergeAbortSignals } from "../ai-gateway"

const API_KEY = "sk-test-0123456789abcdef"

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

function openAiFrame(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}

async function collect(iterable: AsyncIterable<string>): Promise<string> {
  let out = ""
  for await (const piece of iterable) out += piece
  return out
}

function runStream() {
  return generateStream({
    provider: { providerId: "openai", model: "gpt-4o-mini", baseUrl: "https://api.openai.com/v1" },
    messages: [{ role: "user", content: "hi" }],
    apiKey: API_KEY,
    temperature: 0.2,
  })
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  fetchMock.mockReset()
})

describe("OpenAI 兼容 SSE 解析", () => {
  it("读得懂以 LF 分隔的事件流", async () => {
    fetchMock.mockResolvedValue(
      sseResponse([openAiFrame("Hello"), openAiFrame(" world"), "data: [DONE]\n\n"])
    )
    await expect(collect(runStream())).resolves.toBe("Hello world")
  })

  it("事件被切在任意位置时仍能拼回", async () => {
    const whole = openAiFrame("Alpha") + openAiFrame("Beta") + "data: [DONE]\n\n"
    // 按 7 字节切片，模拟网络分片落在帧中间
    const chunks: string[] = []
    for (let i = 0; i < whole.length; i += 7) chunks.push(whole.slice(i, i + 7))
    fetchMock.mockResolvedValue(sseResponse(chunks))
    await expect(collect(runStream())).resolves.toBe("AlphaBeta")
  })

  it("读得懂以 CRLF 分隔的事件流", async () => {
    // RFC 允许 CRLF；不少网关/代理会把流规范化成 CRLF
    const crlf = (body: string) => body.replace(/\n/g, "\r\n")
    fetchMock.mockResolvedValue(
      sseResponse([
        crlf(openAiFrame("Carriage")),
        crlf(openAiFrame("Return")),
        crlf("data: [DONE]\n\n"),
      ])
    )
    await expect(collect(runStream())).resolves.toBe("CarriageReturn")
  })
})

describe("mergeAbortSignals 的降级路径", () => {
  function withoutAbortSignalAny<T>(fn: () => Promise<T>): Promise<T> {
    const original = (AbortSignal as unknown as { any?: unknown }).any
    ;(AbortSignal as unknown as { any?: unknown }).any = undefined
    return fn().finally(() => {
      ;(AbortSignal as unknown as { any?: unknown }).any = original
    })
  }

  it("调用方取消时同步 abort", () => {
    const caller = new AbortController()
    const merged = mergeAbortSignals(caller.signal, 60_000)
    expect(merged?.aborted).toBe(false)
    caller.abort(new Error("caller cancelled"))
    expect(merged?.aborted).toBe(true)
  })

  it("AbortSignal.any 不可用时仍然保留超时能力", async () => {
    await withoutAbortSignalAny(async () => {
      const caller = new AbortController()
      const merged = mergeAbortSignals(caller.signal, 30)
      expect(merged?.aborted).toBe(false)

      // 旧实现在这条路径上直接返回 caller.signal，超时被整个丢掉，
      // 于是这个断言会失败（30ms 后仍未 abort）。
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(merged?.aborted).toBe(true)
      expect(caller.signal.aborted).toBe(false)
    })
  })
})
