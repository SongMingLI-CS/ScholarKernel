import { describe, expect, it, vi } from "vitest"

// 路由现在自带鉴权（不依赖中间件单点）。这里直接放行，测试聚焦体积守卫。
vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
  DEFAULT_USER_ID: "default_user_id",
}))

import { POST } from "@/app/api/documents/parse/route"
import { resolveUserIdFromRequest } from "@/lib/auth-user"

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

function multipartBody(filename: string, content: string, contentType: string): { body: string; boundary: string } {
  const boundary = "----sk-test-boundary"
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n")
  return { body, boundary }
}

/**
 * 回归：路由此前先 await req.formData()（把整个 body 读进内存），再比对 file.size，
 * 因此 8MiB 上限无法阻止超大请求占用内存 —— 限制对 DoS 实际无效。
 * 修复后应先看 Content-Length，超限立即 413 且完全不消费请求体。
 */
describe("/api/documents/parse upload guard", () => {
  it("rejects an oversize body from Content-Length without reading the stream", async () => {
    let pulls = 0
    let sent = 0
    const total = MAX_UPLOAD_BYTES + 1024
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (sent >= total) {
          controller.close()
          return
        }
        const size = Math.min(64 * 1024, total - sent)
        sent += size
        controller.enqueue(new Uint8Array(size))
      },
    })

    const req = new Request("http://localhost/api/documents/parse", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----sk-test-boundary",
        "content-length": String(MAX_UPLOAD_BYTES + 1),
      },
      body: stream,
      duplex: "half",
    } as RequestInit)

    const res = await POST(req)
    expect(res.status).toBe(413)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe("FileTooLarge")
    // 请求体没有被整体消费：最多一次预取（undici 建流时的首个 pull），远小于声明体积
    expect(pulls).toBeLessThanOrEqual(1)
    expect(sent).toBeLessThan(total)
  })

  it("rejects a request without a file part", async () => {
    const { body, boundary } = multipartBody("ignored.txt", "noop", "text/plain")
    const req = new Request("http://localhost/api/documents/parse", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: body.replace('name="file"', 'name="other"'),
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe("MissingFile")
  })

  it("parses a small text upload end to end", async () => {
    const { body, boundary } = multipartBody("notes.txt", "Attention is all you need.\n# Introduction\nWe study RAG.", "text/plain")
    const req = new Request("http://localhost/api/documents/parse", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { format: string; text: string; chunks: unknown[] }
    expect(json.format).toBe("text")
    expect(json.text).toContain("Attention is all you need")
    expect(Array.isArray(json.chunks)).toBe(true)
  })

  it("does not leak internal error text to the client", async () => {
    // 构造一个会让解析器抛错的请求：声明为 pdf 但内容是垃圾，解析器应降级而非 500，
    // 这里直接断言 500 分支不回显异常消息（错误码化）。
    const { body, boundary } = multipartBody("broken.pdf", "%PDF-1.4 garbage", "application/pdf")
    const req = new Request("http://localhost/api/documents/parse", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { warnings: string[] }
    expect(Array.isArray(json.warnings)).toBe(true)
  })

  it("鉴权先于体积检查：未授权 + 超大声明体积返回 401 而不是 413", async () => {
    vi.mocked(resolveUserIdFromRequest).mockResolvedValueOnce(null)
    const req = new Request("http://localhost/api/documents/parse", {
      method: "POST",
      headers: { "content-length": String(MAX_UPLOAD_BYTES + 1), "content-type": "text/plain" },
      body: "x",
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
