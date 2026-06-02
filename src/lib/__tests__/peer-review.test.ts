import { describe, expect, it } from "vitest"

import {
  AREA_CHAIR_PERSONA,
  INNOVATION_SCOUT_PERSONA,
  METHODOLOGY_CRITIC_PERSONA,
  PEER_REVIEW_CANVAS_TITLE,
  buildPeerReviewCanvasOutput,
  getPersonaById,
} from "@/lib/agent/agent-personas"
import {
  buildPeerReviewWorkflowNodes,
  ensurePeerReviewPlan,
  needsPeerReviewIntent,
  parseAndValidateTaskList,
} from "@/lib/agent/planner"
import { executePeerReviewGroup, isPeerReviewGroupStart } from "@/lib/agent/peer-review-runner"
import { peerReviewGroupToFlowLayout } from "@/lib/agent/topology-layout"
import type { WorkflowNode } from "@/lib/agent/planner"

describe("peer review planner", () => {
  it("needsPeerReviewIntent matches abstract and experiment design prompts", () => {
    expect(needsPeerReviewIntent("请对我的论文摘要进行模拟审稿")).toBe(true)
    expect(needsPeerReviewIntent("针对以下研究问题，给出可执行的实验设计")).toBe(true)
    expect(needsPeerReviewIntent("Peer review my abstract: We propose...")).toBe(true)
    expect(needsPeerReviewIntent("你好")).toBe(false)
  })

  it("buildPeerReviewWorkflowNodes returns three peer_review nodes", () => {
    const nodes = buildPeerReviewWorkflowNodes()
    expect(nodes).toHaveLength(3)
    expect(nodes.every((n) => n.type === "peer_review")).toBe(true)
    expect(nodes.map((n) => n.metadata?.peerReviewRole)).toEqual(["reviewer", "reviewer", "meta_review"])
  })

  it("ensurePeerReviewPlan injects peer review workflow when intent detected", () => {
    const base = [{ id: "1", type: "reasoning" as const, provider: "cloud" as const, status: "pending" as const, logs: [] }]
    const planned = ensurePeerReviewPlan(base, "请评审以下摘要")
    expect(planned.some((n) => n.type === "peer_review")).toBe(true)
  })

  it("parseAndValidateTaskList accepts peer_review type", () => {
    const list = parseAndValidateTaskList(
      '{"tasks":[{"id":"pr-1","type":"peer_review","provider":"cloud","title":"模拟评审"}]}'
    )
    expect(list[0]?.type).toBe("peer_review")
  })
})

describe("agent personas", () => {
  it("exports three distinct reviewer personas", () => {
    expect(METHODOLOGY_CRITIC_PERSONA.id).toBe("methodology_critic")
    expect(INNOVATION_SCOUT_PERSONA.id).toBe("innovation_scout")
    expect(AREA_CHAIR_PERSONA.id).toBe("area_chair")
    expect(getPersonaById("area_chair")?.label).toContain("Area Chair")
  })

  it("wraps meta-review in scholar-canvas tag", () => {
    const out = buildPeerReviewCanvasOutput("# Summary\n\nGood paper.")
    expect(out).toContain("<scholar-canvas")
    expect(out).toContain(PEER_REVIEW_CANVAS_TITLE)
    expect(out).toContain("# Summary")
  })
})

describe("peer review topology layout", () => {
  it("assigns fork positions for parallel reviewers and converge to chair", () => {
    const nodes = buildPeerReviewWorkflowNodes()
    const layout = peerReviewGroupToFlowLayout(nodes, 0, { gapX: 240, startX: 40, yMain: 140, yBranch: 40 })
    expect(layout.positions["peer-r1"]?.y).toBeLessThan(layout.positions["peer-r3"]?.y ?? 0)
    expect(layout.positions["peer-r2"]?.y).toBeGreaterThan(layout.positions["peer-r1"]?.y ?? 0)
    expect(layout.edges.some((e) => e.source === "peer-r1" && e.target === "peer-r3")).toBe(true)
    expect(layout.edges.some((e) => e.source === "peer-r2" && e.target === "peer-r3")).toBe(true)
  })
})

describe("peer review group detection", () => {
  it("detects start of peer review group", () => {
    const nodes: WorkflowNode[] = [
      ...buildPeerReviewWorkflowNodes(),
      { id: "x", type: "reasoning", provider: "cloud", status: "pending", logs: [] },
    ]
    expect(isPeerReviewGroupStart(nodes, 0)).toBe(true)
    expect(isPeerReviewGroupStart(nodes, 1)).toBe(false)
    expect(isPeerReviewGroupStart(nodes, 3)).toBe(false)
  })
})

describe("executePeerReviewGroup", () => {
  it("runs parallel reviewers, debate, and meta-review with canvas output", async () => {
    const nodes = buildPeerReviewWorkflowNodes()
    const logs: string[] = []
    const patches: Array<{ id: string; status?: string }> = []

    const result = await executePeerReviewGroup({
      groupNodes: nodes,
      userInput: "Abstract: We propose a novel transformer variant.",
      deps: {
        activeProvider: { providerId: "deepseek_openai_compat", model: "deepseek-chat" },
      },
      hooks: {
        onNodeLog: (_id, line) => logs.push(line),
        onNodePatch: (id, patch) => patches.push({ id, status: patch.status }),
      },
      generateReview: async ({ personaId }) => {
        if (personaId === "methodology_critic") return "Weak ablation study."
        if (personaId === "innovation_scout") return "Incremental novelty."
        return [
          "## Summary",
          "A transformer variant paper.",
          "## Strengths",
          "- Clear writing",
          "## Weaknesses",
          "- Limited ablations",
          "## Score",
          "5",
          "## Final Recommendation",
          "Borderline reject",
        ].join("\n")
      },
      generateDebate: async () => "Reviewer #2 rebuts: the baseline comparison is fair.",
    })

    expect(result).toHaveLength(3)
    expect(result.every((r) => r.ok)).toBe(true)
    expect(result[2]?.output).toMatchObject({ text: expect.stringContaining("<scholar-canvas") })
    expect(logs.some((l) => /Debate|激辩/i.test(l))).toBe(true)
    expect(patches.filter((p) => p.id === "peer-r1" && p.status === "running").length).toBeGreaterThan(0)
    expect(patches.filter((p) => p.id === "peer-r2" && p.status === "running").length).toBeGreaterThan(0)
  })
})
