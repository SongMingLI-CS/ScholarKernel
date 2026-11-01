import { beforeEach, describe, expect, it, vi } from "vitest"

const mockState = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    user: { upsert: vi.fn() },
    conversation: { upsert: vi.fn() },
  },
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockState.prisma }))

const { POST } = await import("@/app/api/integrations/learning-studio/route")

/**
 * Learning Studio 桥接接口的体积上限写在**读完 body 之后**：
 *
 *   const raw = await req.text()
 *   if (Buffer.byteLength(raw) > 100000) return 413
 *
 * `req.text()` 已经把整个请求体缓冲进内存了。这条路由走的不是 `parseJsonBody`，
 * 所以 SK-60 加的「所有路由都经 parseJsonBody」不变量覆盖不到它 —— 这是
 * 「统一了入口，漏了旁路」的典型。100 KB 的上限本身也说明作者预期 body 很小。
 */

const TOKEN = "bridge-token-for-tests"

function bridgeRequest(body: BodyInit, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/integrations/learning-studio", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...headers },
      body,
    })
  )
}

const VALID = {
  requestId: "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  title: "Transformer 综述",
  text: "注意力机制的核心是对 value 加权求和。",
  question: "为什么要除以 sqrt(d_k)？",
  sourceUrl: "https://arxiv.org/abs/1706.03762",
}

describe("Learning Studio 桥接：请求体体积上限", () => {
  beforeEach(() => {
    process.env.SCHOLAR_BRIDGE_TOKEN = TOKEN
    delete process.env.AUTH_USER_ID
    mockState.prisma.$transaction.mockReset()
    mockState.prisma.conversation.upsert.mockReset()
    mockState.prisma.user.upsert.mockReset()
    mockState.prisma.user.upsert.mockResolvedValue({ id: "primary_user" })
    mockState.prisma.conversation.upsert.mockResolvedValue({ id: `learning-${VALID.requestId}` })
    mockState.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        user: { upsert: mockState.prisma.user.upsert },
        conversation: { upsert: mockState.prisma.conversation.upsert },
      })
    )
  })

  it("超限时返回 413，且不把请求体读完", async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 40) {
          controller.close()
          return
        }
        controller.enqueue(new TextEncoder().encode("x".repeat(8192)))
      },
    })
    const req = new Request("http://localhost/api/integrations/learning-studio", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: stream,
      // @ts-expect-error Node 的 fetch 需要显式声明半双工
      duplex: "half",
    })

    const res = await POST(req)
    expect(res.status).toBe(413)
    // 40 个 8 KiB 分片 = 320 KiB，上限 100 KiB：读到第 13 片就该放弃
    expect(pulled).toBeLessThan(20)
    expect(mockState.prisma.$transaction).not.toHaveBeenCalled()
  })

  it("非法 UTF-8 返回 400 而不是 413（两种失败原因不能混用同一状态码）", async () => {
    const res = await bridgeRequest(new Uint8Array([0xff, 0xfe, 0x7b, 0x7d]))
    expect(res.status).toBe(400)
  })

  it("合法请求仍然落库并返回 201", async () => {
    const res = await bridgeRequest(JSON.stringify(VALID))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { conversationId?: string }
    expect(body.conversationId).toBe(`learning-${VALID.requestId}`)
    expect(mockState.prisma.conversation.upsert).toHaveBeenCalledTimes(1)
  })

  it("未配置 token 时 503（不读 body）", async () => {
    delete process.env.SCHOLAR_BRIDGE_TOKEN
    const res = await bridgeRequest(JSON.stringify(VALID))
    expect(res.status).toBe(503)
  })
})
