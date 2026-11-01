import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const proxyAwareFetchMock = vi.fn()

vi.mock("@/lib/proxy-client", () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}))

vi.mock("@/store/useAgentStore", () => ({
  useAgentStore: {
    getState: () => ({ runtimeKeys: {}, actions: {} }),
  },
}))

// 必须在 vi.mock 之后导入，才能拿到被替换的依赖
import { createAcademicSearchTool } from "../search-tool"

const TEST_KEY = "tvly-dev-abcdef1234567890"

type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown>
}

type SearchOut = {
  status: string
  total: number
  results: Array<{ title: string; url: string; source_id: string }>
  message?: string
}

function runTool(input: Record<string, unknown>): Promise<SearchOut> {
  const t = createAcademicSearchTool({ tavilyApiKey: TEST_KEY }) as unknown as ExecutableTool
  if (typeof t.execute !== "function") throw new Error("tool has no execute")
  return t.execute(input, { toolCallId: "test-call", messages: [] }) as Promise<SearchOut>
}

function tavilyResponse(titles: string[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      results: titles.map((t, i) => ({
        title: t,
        url: `https://arxiv.org/abs/${i + 1}`,
        content: `${t} abstract`,
        published_date: "2025-01-01",
      })),
    }),
    text: async () => "",
  } as unknown as Response
}

beforeEach(() => {
  // 检索工具在成功路径上有大量 console.log/console.warn，这里统一静音避免污染测试输出
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  proxyAwareFetchMock.mockReset()
})

describe("academicSearch 多路检索的容错边界", () => {
  it("单路超时不应丢弃其他路已成功的结果", async () => {
    proxyAwareFetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string }
      if (body.query === "graph rag survey") return tavilyResponse(["GraphRAG: A Survey"])
      throw new Error("TavilySearchFailed:429:rate limited")
    })

    const out = await runTool({
      search_query: "graph rag survey",
      search_queries: ["graph rag survey", "graph rag benchmark"],
      academicOnly: true,
      maxResults: 10,
      rerankTopK: 0,
    })

    expect(out.status).toBe("ok")
    expect(out.results.map((r) => r.title)).toEqual(["GraphRAG: A Survey"])
    expect(out.total).toBe(1)
  })

  it("全部并行路失败时才向外抛错", async () => {
    proxyAwareFetchMock.mockRejectedValue(new Error("TavilySearchFailed:503:upstream down"))

    await expect(
      runTool({
        search_query: "q1",
        search_queries: ["q1", "q2"],
        academicOnly: true,
        maxResults: 10,
        rerankTopK: 0,
      })
    ).rejects.toThrow(/TavilySearchFailed/)
  })

  it("降级后仍要为幸存结果重新连续编号 source_id", async () => {
    proxyAwareFetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string }
      if (body.query === "q1") return tavilyResponse(["A", "B"])
      throw new Error("TavilySearchFailed:429")
    })

    const out = await runTool({
      search_query: "q1",
      search_queries: ["q1", "q2"],
      academicOnly: true,
      maxResults: 10,
      rerankTopK: 0,
    })

    expect(out.results.map((r) => r.source_id)).toEqual(["1", "2"])
  })
})

describe("academicSearch 日志中的凭据卫生", () => {
  it("不把 API key 打进 console 输出", async () => {
    proxyAwareFetchMock.mockResolvedValue(tavilyResponse(["A"]))

    const logSpy = vi.spyOn(console, "log")
    const warnSpy = vi.spyOn(console, "warn")

    await runTool({
      search_query: "q1",
      academicOnly: false,
      maxResults: 5,
      rerankTopK: 0,
    })

    const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => call.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "))
      .join("\n")

    expect(logged).not.toContain(TEST_KEY)
    expect(logged).not.toContain(TEST_KEY.slice(0, 12))
  })
})
