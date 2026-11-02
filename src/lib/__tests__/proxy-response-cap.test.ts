import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { POST } from "@/app/api/proxy/[provider]/[...path]/route"

/**
 * 代理路由把上游响应体原样流回客户端：
 *
 *   return new Response(upstreamRes.body, { status, headers })
 *
 * 请求体在 SK-36 已经有 32 MiB 上限，但**响应体**没有任何上限 ——
 * 一个被配置错的上游、或一个被攻击者控制的上游，可以往这个进程灌任意大的响应。
 * 同时响应没有 `X-Content-Type-Options: nosniff`，浏览器会对同源响应做类型嗅探
 * （这个路由是 `/api/proxy/...`，与主应用同源）。
 *
 * 这条路由在未配置 PROXY_ACCESS_TOKEN 时是放行的，所以「响应体上限」不是
 * 「信任上游」的问题，是「上游可能不是你以为的那个上游」的问题。
 */

const PROVIDER = "openai"
const PATH = ["v1", "chat", "completions"]

function ctxOf(provider: string, path: string[]) {
  return { params: Promise.resolve({ provider, path }) }
}

function upstreamResponse({
  status = 200,
  body,
  headers = {},
  contentLength,
}: {
  status?: number
  body: ReadableStream<Uint8Array> | string
  headers?: Record<string, string>
  contentLength?: number
}): Response {
  const h = new Headers(headers)
  if (contentLength !== undefined) h.set("content-length", String(contentLength))
  if (!h.has("content-type")) h.set("content-type", "application/json")
  return new Response(body, { status, headers: h })
}

let fetchCalls: { url: string; init: RequestInit }[] = []
let nextUpstream: (() => Response) | null = null

beforeEach(() => {
  fetchCalls = []
  nextUpstream = null
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      fetchCalls.push({ url, init })
      return nextUpstream ? nextUpstream() : upstreamResponse({ body: "{}" })
    })
  )
  // 默认放行：不要求 PROXY_ACCESS_TOKEN，否则测试要带 token
  delete process.env.PROXY_ACCESS_TOKEN
  delete process.env.PROXY_MAX_RESPONSE_BYTES
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.PROXY_ACCESS_TOKEN
  delete process.env.PROXY_MAX_RESPONSE_BYTES
})

async function callProxy(): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/proxy/${PROVIDER}/${PATH.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    }),
    ctxOf(PROVIDER, PATH)
  )
}

describe("代理响应体上限", () => {
  it("content-length 声明超过上限时返回 413，且不消费上游 body", async () => {
    let pulled = 0
    nextUpstream = () =>
      upstreamResponse({
        contentLength: 100_000_000,
        body: new ReadableStream({
          pull(controller) {
            pulled += 1
            controller.enqueue(new Uint8Array(8192))
          },
        }),
      })
    process.env.PROXY_MAX_RESPONSE_BYTES = "1048576" // 1 MiB

    const res = await callProxy()
    expect(res.status).toBe(413)
    // content-length 是声明值，先看它就拒绝；undici 构造 Response 时可能预拉
    // 1 个分片（与 json-body-limit 同现象），但绝不该把 100 MB 拉完。
    expect(pulled).toBeLessThanOrEqual(1)
  })

  it("没有 content-length 时边转发边计数，超限中止且不把整份读完", async () => {
    let pulled = 0
    nextUpstream = () =>
      upstreamResponse({
        body: new ReadableStream({
          pull(controller) {
            pulled += 1
            if (pulled > 50) {
              controller.close()
              return
            }
            controller.enqueue(new Uint8Array(8192)) // 50 * 8 KiB = 400 KiB
          },
        }),
      })
    process.env.PROXY_MAX_RESPONSE_BYTES = "65536" // 64 KiB → 第 9 片就该中止

    const res = await callProxy()
    // 已经开始流式转发，状态行已发出；上限在 body 里触发
    expect(res.status).toBe(200)
    // 读取响应体应在中途出错
    await expect(res.text()).rejects.toBeTruthy()
    // 没有把 400 KiB 全拉完
    expect(pulled).toBeLessThan(20)
  })

  it("合法响应原样转发", async () => {
    nextUpstream = () =>
      upstreamResponse({ body: '{"id":"chatcmpl-1","choices":[]}' })
    const res = await callProxy()
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"id":"chatcmpl-1","choices":[]}')
  })
})

describe("代理响应的安全头", () => {
  it("所有响应都带 X-Content-Type-Options: nosniff", async () => {
    nextUpstream = () => upstreamResponse({ body: "{}" })
    const res = await callProxy()
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
  })

  it("上游返回 text/html 时仍加 nosniff（防止同源嗅探成 HTML）", async () => {
    nextUpstream = () =>
      upstreamResponse({
        body: "<html><script>alert(1)</script></html>",
        headers: { "content-type": "text/html" },
      })
    const res = await callProxy()
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-type")).toBe("text/html")
  })
})
