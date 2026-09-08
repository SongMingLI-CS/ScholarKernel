import { describe, expect, it, vi } from "vitest"

import { scheduleWorkflowDag, type DagNodeState } from "@/lib/agent/dag-scheduler"
import { dagNodeFingerprints } from "@/lib/agent/dag-fingerprint"
import type { WorkflowNode } from "@/lib/agent/planner"

const node = (id: string, dependsOn: string[] = [], patch: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id, type: "reasoning", provider: "cloud", status: "pending", dependsOn,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 }, timeoutMs: 500, failurePolicy: "fail-fast", ...patch,
})

describe("single-process DAG scheduler", () => {
  it("runs downstream only after every dependency and passes upstream outputs", async () => {
    const events: string[] = []
    const result = await scheduleWorkflowDag({
      nodes: [node("a"), node("b"), node("join", ["a", "b"])],
      concurrency: 2,
      runner: async (item, context) => {
        events.push(`start:${item.id}`)
        if (item.id === "join") expect(Object.keys(context.upstreamResults).sort()).toEqual(["a", "b"])
        await new Promise((resolve) => setTimeout(resolve, 5))
        events.push(`end:${item.id}`)
        return { output: item.id }
      },
    })
    expect(events.indexOf("start:join")).toBeGreaterThan(events.indexOf("end:a"))
    expect(events.indexOf("start:join")).toBeGreaterThan(events.indexOf("end:b"))
    expect(result.outputs.join).toBe("join")
  })

  it("runs independent ready nodes concurrently within the limit", async () => {
    let active = 0
    let maxActive = 0
    await scheduleWorkflowDag({
      nodes: [node("a"), node("b"), node("c"), node("join", ["a", "b", "c"])],
      concurrency: 2,
      runner: async (item) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, item.id === "join" ? 1 : 10))
        active -= 1
        return { output: item.id }
      },
    })
    expect(maxActive).toBe(2)
  })

  it("retries with controlled backoff and records attempt count", async () => {
    const runner = vi.fn(async (_item, context) => {
      if (context.attempt < 3) throw new Error("transient")
      return { output: "ok" }
    })
    const result = await scheduleWorkflowDag({ nodes: [node("a", [], { retryPolicy: { maxAttempts: 3, backoffMs: 1 } })], runner })
    expect(runner).toHaveBeenCalledTimes(3)
    expect(result.states.get("a")?.attemptCount).toBe(3)
  })

  it("times out a node", async () => {
    const result = await scheduleWorkflowDag({
      nodes: [node("a", [], { timeoutMs: 5 })],
      runner: async () => { await new Promise((resolve) => setTimeout(resolve, 30)); return { output: "late" } },
    })
    expect(result.states.get("a")).toMatchObject({ status: "error", errorCategory: "timeout" })
  })

  it("implements fail-fast, continue, and fallback policies", async () => {
    const failFast = await scheduleWorkflowDag({
      nodes: [node("a", [], { failurePolicy: "fail-fast" }), node("b", ["a"])],
      runner: async (item) => { if (item.id === "a") throw new Error("boom"); return { output: "never" } },
    })
    expect(failFast.states.get("b")?.status).toBe("cancelled")

    const continued = await scheduleWorkflowDag({
      nodes: [node("a", [], { failurePolicy: "continue" }), node("b", ["a"])],
      runner: async (item) => { if (item.id === "a") throw new Error("boom"); return { output: "continued" } },
    })
    expect(continued.states.get("b")?.status).toBe("done")

    const fallback = await scheduleWorkflowDag({
      nodes: [node("a", [], { failurePolicy: "fallback" })],
      runner: async () => { throw new Error("boom") },
      fallbackRunner: async () => ({ output: "fallback-output", fallback: true }),
    })
    expect(fallback.states.get("a")).toMatchObject({ status: "done", output: "fallback-output" })
  })

  it("does not start later ready batches after fail-fast", async () => {
    const runner = vi.fn(async (item: WorkflowNode) => {
      if (item.id === "a") throw new Error("boom")
      return { output: item.id }
    })
    const result = await scheduleWorkflowDag({
      nodes: [node("a"), node("b"), node("c"), node("join", ["a", "b", "c"])],
      concurrency: 1,
      runner,
    })
    expect(runner).toHaveBeenCalledTimes(1)
    expect(result.states.get("b")?.status).toBe("cancelled")
    expect(result.states.get("c")?.status).toBe("cancelled")
    expect(result.states.get("join")?.status).toBe("cancelled")
  })

  it("propagates cancellation to running and not-started downstream nodes", async () => {
    const controller = new AbortController()
    const run = scheduleWorkflowDag({
      nodes: [node("a"), node("b", ["a"])], signal: controller.signal,
      runner: async (_item, context) => new Promise((_resolve, reject) => context.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })),
    })
    setTimeout(() => controller.abort(), 5)
    const result = await run
    expect(result.states.get("a")?.status).toBe("cancelled")
    expect(result.states.get("b")?.status).toBe("cancelled")
  })

  it("reuses checkpoints only while input and upstream fingerprints match", async () => {
    const parentFp = dagNodeFingerprints({ q: 1 }, {})
    const childFp = dagNodeFingerprints({ q: 2 }, { a: "old" })
    const reusable = new Map<string, DagNodeState>([
      ["a", { node: node("a", [], { input: { q: 1 } }), status: "done", output: "old", attemptCount: 1, ...parentFp }],
      ["b", { node: node("b", ["a"], { input: { q: 2 } }), status: "done", output: "child", attemptCount: 1, ...childFp }],
    ])
    const runner = vi.fn(async (item) => ({ output: item.id === "a" ? "new" : "recomputed" }))
    const reused = await scheduleWorkflowDag({ nodes: [node("a", [], { input: { q: 1 } }), node("b", ["a"], { input: { q: 2 } })], runner, reusableStates: reusable })
    expect(runner).not.toHaveBeenCalled()
    expect(reused.outputs.b).toBe("child")

    const invalidated = await scheduleWorkflowDag({ nodes: [node("a", [], { input: { q: "changed" } }), node("b", ["a"], { input: { q: 2 } })], runner, reusableStates: reusable })
    expect(runner).toHaveBeenCalledTimes(2)
    expect(invalidated.outputs.b).toBe("recomputed")
  })

  it("awaits persistence before publishing terminal state", async () => {
    const order: string[] = []
    await scheduleWorkflowDag({
      nodes: [node("a")], runner: async () => ({ output: "ok" }),
      persist: async (state) => { if (state.status === "done") order.push("persist") },
      publish: async (event) => { if (event.type === "node" && event.patch.status === "done") order.push("publish") },
    })
    expect(order).toEqual(["persist", "publish"])
  })
})
