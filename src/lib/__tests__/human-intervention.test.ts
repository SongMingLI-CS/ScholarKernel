import { describe, expect, it, vi, beforeEach } from "vitest"

import {
  resetHumanInterventionGatesForTests,
  resolveHumanInterventionSession,
  waitForHumanIntervention,
} from "@/lib/agent/human-intervention-gate"
import { pruneWorkflowAfterHumanIntervention } from "@/lib/agent/human-intervention-pruning"
import { hasPeerReviewScoreGap } from "@/lib/agent/peer-review-score-gap"
import { executePeerReviewGroup } from "@/lib/agent/peer-review-runner"
import { buildPeerReviewWorkflowNodes } from "@/lib/agent/planner"
import { POST } from "@/app/api/agent/intervention/route"

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    agentJob: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

describe("human intervention gate", () => {
  beforeEach(() => {
    resetHumanInterventionGatesForTests()
  })

  it("suspends until resolveHumanInterventionSession is called", async () => {
    const pending = waitForHumanIntervention("sess-1", "peer-r3", "Wait for expert guidance")
    const resolved = resolveHumanInterventionSession("sess-1", { action: "approve" })
    expect(resolved.ok).toBe(true)
    await expect(pending).resolves.toEqual({ action: "approve" })
  })

  it("returns pruned topology on redirect decision", async () => {
    const nodes = buildPeerReviewWorkflowNodes()
    const instruction = "跳过 R2 反驳，重点规划第三章重写"
    const pending = waitForHumanIntervention("sess-2", "peer-r3", "Wait for expert guidance")

    const pruned = pruneWorkflowAfterHumanIntervention({
      nodes,
      breakpointNodeId: "peer-r3",
      instruction,
    })

    resolveHumanInterventionSession("sess-2", {
      action: "redirect",
      instruction,
      prunedNodes: pruned.nodes,
    })

    const decision = await pending
    expect(decision.action).toBe("redirect")
    if (decision.action === "redirect") {
      expect(decision.prunedNodes?.length).toBe(nodes.length + 1)
      expect(decision.prunedNodes?.some((n) => n.type === "reasoning")).toBe(true)
    }
  })
})

describe("peer review score gap", () => {
  it("detects conflicting accept/reject verdicts", () => {
    expect(hasPeerReviewScoreGap("Overall: Accept, solid contribution", "Recommendation: Reject")).toBe(true)
    expect(hasPeerReviewScoreGap("Weak accept with minor fixes", "Weak accept too")).toBe(false)
  })

  it("detects numeric score divergence", () => {
    expect(hasPeerReviewScoreGap("Score: 8/10 methodology sound", "Rating: 3/10 not convincing")).toBe(true)
  })
})

describe("executePeerReviewGroup human-in-the-loop", () => {
  beforeEach(() => {
    resetHumanInterventionGatesForTests()
  })

  it("hits breakpoint -> pending_approval -> redirect -> prunes topology and resumes", async () => {
    const nodes = buildPeerReviewWorkflowNodes()
    const patches: Array<{ id: string; status?: string }> = []
    let prunedCount = 0

    const runPromise = executePeerReviewGroup({
      groupNodes: nodes,
      allWorkflowNodes: nodes,
      userInput: "Abstract: human loop test",
      deps: {
        activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-chat" },
        interventionSessionId: "hitl-session",
      },
      hooks: {
        onNodeLog: () => {},
        onNodePatch: (id, patch) => patches.push({ id, status: patch.status }),
        onInterventionPending: (event) => {
          expect(event.nodeId).toBe("peer-r3")
          expect(event.status).toBe("pending_approval")
          queueMicrotask(() => {
            const pruned = pruneWorkflowAfterHumanIntervention({
              nodes,
              breakpointNodeId: "peer-r3",
              instruction: "跳过 R2 无用反驳，Canvas 重点第三章重写",
            })
            resolveHumanInterventionSession("hitl-session", {
              action: "redirect",
              instruction: "跳过 R2 无用反驳，Canvas 重点第三章重写",
              prunedNodes: pruned.nodes,
            })
          })
        },
        onWorkflowTopologyPruned: (pruned) => {
          prunedCount = pruned.length
        },
      },
      generateReviewStream: async ({ personaId, onProgress }) => {
        const text = personaId === "methodology_critic" ? "Score: 8 Accept" : "Score: 2 Reject"
        onProgress?.({ streamId: personaId, text, delta: text })
        return text
      },
      generateReview: async () => "## Meta\nChapter 3 rewrite plan injected",
      generateDebate: async () => {
        throw new Error("DebateShouldBeSkipped")
      },
      waitForHumanIntervention,
    })

    const results = await runPromise
    expect(patches.some((p) => p.id === "peer-r3" && p.status === "pending_approval")).toBe(true)
    expect(patches.some((p) => p.id === "peer-r3" && p.status === "done")).toBe(true)
    expect(prunedCount).toBeGreaterThan(nodes.length)
    expect(results.some((r) => r.id === "peer-r3" && r.ok)).toBe(true)
  })
})

describe("POST /api/agent/intervention", () => {
  beforeEach(() => {
    resetHumanInterventionGatesForTests()
  })

  it("wakes suspended session and returns ok", async () => {
    void waitForHumanIntervention("api-sess", "peer-r3", "Wait for expert guidance")

    const res = await POST(
      new Request("http://localhost/api/agent/intervention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "api-sess",
          nodeId: "peer-r3",
          action: "approve",
        }),
      })
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; nodeId?: string }
    expect(body.ok).toBe(true)
    expect(body.nodeId).toBe("peer-r3")
  })
})
