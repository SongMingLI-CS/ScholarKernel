import { describe, expect, it, vi } from "vitest"
import { AgentExecutor } from "@/lib/agent-executor"
import { buildPeerReviewWorkflowNodes } from "@/lib/agent/planner"
import { getPendingIntervention, resolveHumanInterventionSession, waitForHumanIntervention } from "@/lib/agent/human-intervention-gate"
import { consumeStreamTextOutput } from "@/lib/agent/llm-utils"
import type { streamText } from "ai"

const fixture = vi.hoisted(() => ({ searchStatus: "ok", failChair: false, prompts: [] as string[] }))
vi.mock("ai", async (original) => ({
  ...await original<typeof import("ai")>(),
  generateText: vi.fn(async () => ({ text: JSON.stringify({ tasks: [
    { id: "research-1", type: "research", provider: "cloud", input: { search_query: "Attention Is All You Need" } },
    ...buildPeerReviewWorkflowNodes(),
  ] }), usage: {} })),
  streamText: vi.fn((options: { prompt?: string; system?: string }) => {
    fixture.prompts.push(options.prompt ?? "")
    const chair = options.system?.includes("Area Chair")
    return {
      fullStream: (async function* () {
        if (chair && fixture.failChair) throw new Error("FixtureModelUnavailable")
        yield { type: "text-delta", text: chair ? "FIXTURE meta-review: evidence [1]; limitations require human judgment." : "FIXTURE review: Score: 5/10; submission needs controlled baselines." }
      })(),
      usage: Promise.resolve({}),
    }
  }),
}))
vi.mock("@/lib/tools/search-tool", async (original) => ({
  ...await original<typeof import("@/lib/tools/search-tool")>(),
  createAcademicSearchTool: () => ({ execute: async () => ({
    provider: "tavily", query: "Attention Is All You Need", academicOnly: true,
    status: fixture.searchStatus, total: fixture.searchStatus === "ok" ? 1 : 0,
    results: fixture.searchStatus === "ok" ? [{ source_id: "1", title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", snippet: "FIXTURE metadata, not a live retrieval." }] : [],
    message: fixture.searchStatus === "ok" ? undefined : "Fixture search unavailable",
  }) }),
}))

const input = "请检索 Attention Is All You Need，并对摘要进行同行评审：我们提出 Transformer 变体，待验证。"
function executor(session: string, patches: Array<{ id: string; status?: string }>) {
  return new AgentExecutor({
    activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-chat" },
    runtimeKeys: { deepseek: "fixture-key-not-real" }, interventionSessionId: session,
  }, {
    onNodePatch: (id, patch) => patches.push({ id, status: patch.status }),
  })
}

describe("fixed-input workflow audit (all LLM and retrieval responses are fixtures)", () => {
  it("carries sources and node status through actual executor and waits for a human decision", async () => {
    fixture.searchStatus = "ok"; fixture.failChair = false; fixture.prompts = []
    const patches: Array<{ id: string; status?: string }> = []
    const run = executor("audit-success", patches).run(input)
    await vi.waitFor(() => expect(getPendingIntervention("audit-success")).not.toBeNull())
    expect(patches.some(p => p.status === "pending_approval")).toBe(true)
    expect(fixture.prompts.some(p => p.includes("最终 meta-review"))).toBe(false)
    resolveHumanInterventionSession("audit-success", { action: "approve" })
    const result = await run
    expect(result.nodes.every(n => n.status === "done")).toBe(true)
    expect(result.sources[0].url).toBe("https://arxiv.org/abs/1706.03762")
    expect(fixture.prompts.filter(p => p.includes("SUBMISSION")).every(p => p.includes("https://arxiv.org/abs/1706.03762"))).toBe(true)
    console.log("AUDIT_FIXTURE_SUCCESS", JSON.stringify({ input, states: result.nodes.map(n => [n.id, n.status]), sources: result.sources, final: result.final }))
  })

  it("marks unavailable retrieval explicitly and gives reviewers no invented source", async () => {
    fixture.searchStatus = "failed"; fixture.failChair = false; fixture.prompts = []
    const run = executor("audit-missing-source", []).run(input)
    const result = await run
    expect(result.nodes.find(n => n.type === "research")?.status).toBe("error")
    expect(result.sources).toEqual([])
    expect(result.nodes.filter(n => n.type === "peer_review").every(n => n.status === "error")).toBe(true)
    expect(fixture.prompts).toEqual([])
    expect(result.final).toContain("未检索到可核验来源")
  })

  it("marks the chair error when model generation fails", async () => {
    fixture.searchStatus = "ok"; fixture.failChair = true; fixture.prompts = []
    const run = executor("audit-model-failure", []).run(input)
    await vi.waitFor(() => expect(getPendingIntervention("audit-model-failure")).not.toBeNull())
    resolveHumanInterventionSession("audit-model-failure", { action: "approve" })
    const result = await run
    expect(result.nodes.find(n => n.id === "peer-r3")?.status).toBe("error")
    expect(result.final).toContain("FixtureModelUnavailable")
  })
})

describe("intervention cancellation", () => {
  it("aborts an executor waiting for approval without reporting a completed run", async () => {
    fixture.searchStatus = "ok"; fixture.failChair = false; fixture.prompts = []
    const controller = new AbortController()
    const run = new AgentExecutor({
      activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-chat" },
      runtimeKeys: { deepseek: "fixture-key-not-real" },
      interventionSessionId: "audit-cancel-running", signal: controller.signal,
    }).run(input)
    // Install the rejection handler before aborting to avoid unhandled rejection races.
    const outcome = run.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
    await vi.waitFor(() => expect(getPendingIntervention("audit-cancel-running")).not.toBeNull())
    controller.abort()
    expect((await outcome).error?.message).toMatch(/abort/i)
    expect(getPendingIntervention("audit-cancel-running")).toBeNull()
  })

  it("rejects an already aborted signal without leaving a pending gate", async () => {
    const controller = new AbortController(); controller.abort()
    const pending = waitForHumanIntervention("audit-aborted", "peer-r3", "approval", controller.signal)
    await expect(Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve("hung"), 20))])).rejects.toThrow(/abort/i)
    expect(getPendingIntervention("audit-aborted")).toBeNull()
  })

  it("propagates SDK error parts instead of accepting a partial answer as complete", async () => {
    const streamed = {
      fullStream: (async function* () {
        yield { type: "text-delta", text: "partial unverified draft" }
        yield { type: "error", error: new Error("FixtureStreamError") }
      })(),
    } as unknown as Awaited<ReturnType<typeof streamText>>
    await expect(consumeStreamTextOutput(streamed, () => {})).rejects.toThrow("FixtureStreamError")
  })
})
