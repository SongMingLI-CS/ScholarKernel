import { afterEach, describe, expect, it } from "vitest"

import {
  DEFAULT_PROXY_MAX_BODY_BYTES,
  DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS,
  ProxyBodyTooLargeError,
  readBoundedRequestBody,
  resolveProxyMaxBodyBytes,
  resolveProxyUpstreamTimeoutMs,
} from "@/lib/proxy-gateway"

/**
 * `/api/proxy/[provider]/[...path]` 原实现直接 `await req.arrayBuffer()`。
 *
 * 这个路由在未配置 `PROXY_ACCESS_TOKEN` 时是**放行**的（默认部署形态），
 * 于是任何人都能往它 POST 任意大小的请求体，全部驻留内存后才转发。
 * App Router 的 route handler 不像 Server Actions 有 body 体积上限兜底，
 * 限流又是按可伪造的 `x-forwarded-for` 计数 —— 一串并发的百兆请求就足以拖垮进程。
 */

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

function requestWithStream(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/proxy/openai/v1/chat/completions", {
    method: "POST",
    headers,
    body: streamOf(chunks),
    // Node 的 fetch 要求流式请求体声明 half duplex
    duplex: "half",
  } as RequestInit)
}

afterEach(() => {
  delete process.env.PROXY_MAX_BODY_BYTES
  delete process.env.PROXY_UPSTREAM_TIMEOUT_MS
})

describe("readBoundedRequestBody", () => {
  it("正常大小原样返回全部字节", async () => {
    const buf = await readBoundedRequestBody(requestWithStream([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]), 1024)
    expect(Array.from(new Uint8Array(buf))).toEqual([1, 2, 3, 4, 5])
  })

  it("流式请求体超过上限时抛 413，而不是无限缓冲", async () => {
    const big = new Uint8Array(2048).fill(7)
    await expect(readBoundedRequestBody(requestWithStream([big]), 1024)).rejects.toBeInstanceOf(
      ProxyBodyTooLargeError
    )
    try {
      await readBoundedRequestBody(requestWithStream([big]), 1024)
    } catch (e) {
      expect((e as ProxyBodyTooLargeError).status).toBe(413)
    }
  })

  it("声明的 content-length 超限时在读取前就拒绝", async () => {
    const req = requestWithStream([new Uint8Array(8)], { "content-length": String(10 * 1024 * 1024) })
    await expect(readBoundedRequestBody(req, 1024)).rejects.toBeInstanceOf(ProxyBodyTooLargeError)
  })

  it("分片累计超限同样拒绝（不能只看单块大小）", async () => {
    const chunks = Array.from({ length: 8 }, () => new Uint8Array(256).fill(1))
    await expect(readBoundedRequestBody(requestWithStream(chunks), 1024)).rejects.toBeInstanceOf(
      ProxyBodyTooLargeError
    )
  })

  it("空请求体返回空 buffer", async () => {
    const req = new Request("http://localhost/x", { method: "POST" })
    const buf = await readBoundedRequestBody(req, 1024)
    expect(buf.byteLength).toBe(0)
  })
})

describe("上限与超时配置", () => {
  it("默认上限是有限值", () => {
    expect(DEFAULT_PROXY_MAX_BODY_BYTES).toBeGreaterThan(0)
    expect(Number.isFinite(DEFAULT_PROXY_MAX_BODY_BYTES)).toBe(true)
    expect(resolveProxyMaxBodyBytes()).toBe(DEFAULT_PROXY_MAX_BODY_BYTES)
  })

  it("环境变量可覆盖，非法值回落默认", () => {
    process.env.PROXY_MAX_BODY_BYTES = "4096"
    expect(resolveProxyMaxBodyBytes()).toBe(4096)
    process.env.PROXY_MAX_BODY_BYTES = "-1"
    expect(resolveProxyMaxBodyBytes()).toBe(DEFAULT_PROXY_MAX_BODY_BYTES)
    process.env.PROXY_MAX_BODY_BYTES = "abc"
    expect(resolveProxyMaxBodyBytes()).toBe(DEFAULT_PROXY_MAX_BODY_BYTES)
  })

  it("上游超时有默认值且可覆盖", () => {
    expect(resolveProxyUpstreamTimeoutMs()).toBe(DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS)
    expect(DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS).toBeGreaterThan(1000)
    process.env.PROXY_UPSTREAM_TIMEOUT_MS = "2500"
    expect(resolveProxyUpstreamTimeoutMs()).toBe(2500)
    process.env.PROXY_UPSTREAM_TIMEOUT_MS = "0"
    expect(resolveProxyUpstreamTimeoutMs()).toBe(DEFAULT_PROXY_UPSTREAM_TIMEOUT_MS)
  })
})
