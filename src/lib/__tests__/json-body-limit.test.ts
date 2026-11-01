import { describe, expect, it } from "vitest"

import { DEFAULT_MAX_JSON_BODY_BYTES, parseJsonBody, resolveMaxJsonBodyBytes } from "../api-utils"

/**
 * 路由层 JSON 请求体必须有上限。
 *
 * 原来的实现就是 `await req.json()` —— Next.js 的 Route Handler 不像 Server Action
 * 那样有默认体积限制，于是任何一条 API 都能被一个巨大的请求体拖到 OOM。
 * 「所有路由都要经 parseJsonBody」这条不变量当时只统一了**入口**，没统一**上限**。
 */

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  })
}

describe("parseJsonBody：正常路径", () => {
  it("解析合法 JSON", async () => {
    const parsed = await parseJsonBody<{ a: number }>(jsonRequest(JSON.stringify({ a: 1 })))
    expect(parsed).toEqual({ a: 1 })
  })

  it("非法 JSON 返回 null（不抛）", async () => {
    expect(await parseJsonBody(jsonRequest("{not json"))).toBeNull()
  })

  it("空 body 返回 null", async () => {
    expect(
      await parseJsonBody(
        new Request("http://localhost/api/x", { method: "POST" })
      )
    ).toBeNull()
  })

  it("正好等于上限的 body 仍可解析", async () => {
    const payload = JSON.stringify({ a: "x".repeat(64) })
    const parsed = await parseJsonBody<{ a: string }>(jsonRequest(payload), payload.length)
    expect(parsed?.a.length).toBe(64)
  })
})

describe("parseJsonBody：体积上限", () => {
  it("优先用 content-length 提前拒绝，且不把请求体读完", async () => {
    // 注意：undici 的 Request 在构造时可能已经拉过 1 个分片，所以断言「没有被读完」
    // （pulled 远小于总分片数）而不是「一次都没拉」。
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 5) {
          controller.close()
          return
        }
        controller.enqueue(new TextEncoder().encode(`{"chunk":${pulled}}`))
      },
    })
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      headers: { "content-length": "1048576" },
      body: stream,
      // @ts-expect-error Node 的 fetch 需要显式声明半双工
      duplex: "half",
    })
    const parsed = await parseJsonBody(req, 1024)
    expect(parsed).toBeNull()
    expect(pulled).toBeLessThanOrEqual(1)
  })

  it("没有 content-length 时边读边限，超限立刻放弃", async () => {
    const req = jsonRequest(JSON.stringify({ a: "y".repeat(20_000) }))
    req.headers.delete("content-length")
    expect(await parseJsonBody(req, 1024)).toBeNull()
  })

  it("默认上限是有限值，并可由环境变量覆盖", () => {
    expect(Number.isFinite(DEFAULT_MAX_JSON_BODY_BYTES)).toBe(true)
    expect(DEFAULT_MAX_JSON_BODY_BYTES).toBeGreaterThan(1024 * 1024)
    const prev = process.env.API_MAX_JSON_BODY_BYTES
    process.env.API_MAX_JSON_BODY_BYTES = "2048"
    try {
      expect(resolveMaxJsonBodyBytes()).toBe(2048)
    } finally {
      if (prev === undefined) delete process.env.API_MAX_JSON_BODY_BYTES
      else process.env.API_MAX_JSON_BODY_BYTES = prev
    }
  })

  it("环境变量非法时回落到默认值", () => {
    const prev = process.env.API_MAX_JSON_BODY_BYTES
    process.env.API_MAX_JSON_BODY_BYTES = "abc"
    try {
      expect(resolveMaxJsonBodyBytes()).toBe(DEFAULT_MAX_JSON_BODY_BYTES)
    } finally {
      if (prev === undefined) delete process.env.API_MAX_JSON_BODY_BYTES
      else process.env.API_MAX_JSON_BODY_BYTES = prev
    }
  })
})
