import { describe, expect, it, vi } from "vitest"

import {
  isStageComplete,
  mergePeerReviewCheckpoint,
  parsePeerReviewCheckpoint,
} from "@/lib/agent/peer-review-checkpoint"
import { executePeerReviewGroup } from "@/lib/agent/peer-review-runner"
import { buildPeerReviewWorkflowNodes } from "@/lib/agent/planner"
import type { NodeProgressPayload } from "@/lib/agent/executor-types"

describe("peer review checkpoint", () => {
  it("parsePeerReviewCheckpoint extracts peerReview from AgentJob checkpoint", () => {
    const cp = parsePeerReviewCheckpoint({
      phase: "running",
      peerReview: {
        version: 1,
        subject: "Abstract: test",
        methodologyReview: "R1 draft",
        completedStages: ["r1"],
      },
    })
    expect(cp?.methodologyReview).toBe("R1 draft")
    expect(isStageComplete(cp, "r1")).toBe(true)
    expect(isStageComplete(cp, "r2")).toBe(false)
  })

  it("mergePeerReviewCheckpoint marks stages without dropping prior drafts", () => {
    const base = mergePeerReviewCheckpoint(null, {
      subject: "Abstract",
      methodologyReview: "critique",
      markComplete: "r1",
    })
    const next = mergePeerReviewCheckpoint(base, {
      innovationReview: "novelty",
      markComplete: "r2",
    })
    expect(next.methodologyReview).toBe("critique")
    expect(next.innovationReview).toBe("novelty")
    expect(next.completedStages).toEqual(expect.arrayContaining(["r1", "r2"]))
  })
})

describe("executePeerReviewGroup checkpoint resume", () => {
  it("skips R1 LLM when methodologyReview already checkpointed", async () => {
    const nodes = buildPeerReviewWorkflowNodes()
    const generateReview = vi.fn(async ({ personaId }) => {
      if (personaId === "methodology_critic") return "should-not-run"
      if (personaId === "innovation_scout") return "R2 fresh"
      return "## Summary\nok"
    })

    const checkpoints: unknown[] = []
    await executePeerReviewGroup({
      groupNodes: nodes,
      userInput: "Abstract: resume test",
      deps: { activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-chat" } },
      hooks: { onNodeLog: () => {}, onNodePatch: () => {} },
      checkpoint: {
        version: 1,
        subject: "Abstract: resume test",
        methodologyReview: "R1 from DB",
        completedStages: ["r1"],
      },
      onCheckpoint: (cp) => {
        checkpoints.push(cp)
      },
      generateReview,
      generateDebate: async () => "debate ok",
    })

    expect(generateReview).not.toHaveBeenCalledWith(
      expect.objectContaining({ personaId: "methodology_critic" })
    )
    expect(generateReview).toHaveBeenCalledWith(expect.objectContaining({ personaId: "innovation_scout" }))
    expect(checkpoints.some((c) => (c as { markComplete?: string }).markComplete === "r2")).toBe(true)
  })
})

describe("executePeerReviewGroup stream isolation", () => {
  it("emits onProgress with distinct streamId for parallel reviewers", async () => {
    const nodes = buildPeerReviewWorkflowNodes()
    const progress: NodeProgressPayload[] = []

    await executePeerReviewGroup({
      groupNodes: nodes,
      userInput: "Abstract: stream test",
      deps: { activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-chat" } },
      hooks: {
        onNodeLog: () => {},
        onNodePatch: () => {},
        onProgress: (p) => progress.push(p),
      },
      generateReviewStream: async ({ personaId, onProgress }) => {
        const chunks = personaId === "methodology_critic" ? ["M1", " M2"] : ["I1", " I2"]
        let acc = ""
        for (const ch of chunks) {
          acc += ch
          onProgress?.({ streamId: personaId, text: acc, delta: ch })
        }
        return acc.trim()
      },
      generateReview: async ({ personaId }) => (personaId === "area_chair" ? "## Summary\nok" : "fallback"),
      generateDebate: async () => "debate",
    })

    const r1Deltas = progress.filter((p) => p.streamId === "methodology_critic" && p.kind === "stream_delta")
    const r2Deltas = progress.filter((p) => p.streamId === "innovation_scout" && p.kind === "stream_delta")
    expect(r1Deltas.length).toBeGreaterThan(0)
    expect(r2Deltas.length).toBeGreaterThan(0)
    expect(r1Deltas.every((p) => !String(p.text).includes("I1"))).toBe(true)
    expect(r2Deltas.every((p) => !String(p.text).includes("M1"))).toBe(true)
  })
})
