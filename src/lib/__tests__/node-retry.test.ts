import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  assembleFinalFromResults,
  findTargetNodeIndex,
  prepareNodesForPartialResume,
  restoreExecutionStateFromSnapshots,
  shouldSkipNodeForResume,
  snapshotMap,
  snapshotsFromWorkflowNodes,
} from "@/lib/agent/node-resume"
import { loadAgentNodeSnapshots, persistAgentNodeSnapshotAsync, upsertAgentNodeSnapshot } from "@/lib/agent-jobs"
import type { WorkflowNode } from "@/lib/agent/planner"
import { POST } from "@/app/api/agent/run/route"

const { runAgentOnServer } = vi.hoisted(() => ({
  runAgentOnServer: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-test"),
}))

vi.mock("@/lib/agent-server-run", () => ({
  runAgentOnServer,
}))

vi.mock("@/lib/server-runtime-keys", () => ({
  loadRuntimeKeysForUser: vi.fn(async () => ({ openai: "server-key" })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userBilling: {
      upsert: vi.fn(async ({ where, create }: { where: { userId: string }; create: { userId: string; tokenQuota: number } }) => ({
        userId: where.userId,
        tokenUsed: 0,
        tokenQuota: create.tokenQuota,
        totalSpent: 0,
        updatedAt: new Date(),
      })),
    },
    agentJob: {
      findFirst: vi.fn(),
    },
    agentNode: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/prisma"

function serialWorkflowNodes(): WorkflowNode[] {
  return [
    {
      id: "research-1",
      type: "research",
      provider: "cloud",
      status: "done",
      title: "Global Search",
      logs: [],
      output: { total: 3, results: [{ title: "Paper A", url: "https://a", snippet: "snippet" }] },
    },
    {
      id: "reasoning-2",
      type: "reasoning",
      provider: "cloud",
      status: "done",
      title: "Synthesis",
      logs: [],
      output: { text: "Intermediate synthesis from node 2.", finalResponse: "Intermediate synthesis from node 2." },
    },
    {
      id: "reasoning-3",
      type: "reasoning",
      provider: "cloud",
      status: "error",
      title: "Final Canvas",
      logs: [],
      error: "API timeout",
    },
  ]
}

describe("node-resume pure logic", () => {
  it("findTargetNodeIndex locates node by id", () => {
    const nodes = serialWorkflowNodes()
    expect(findTargetNodeIndex(nodes, "reasoning-3")).toBe(2)
    expect(() => findTargetNodeIndex(nodes, "missing")).toThrow(/TargetNodeNotFound/)
  })

  it("shouldSkipNodeForResume skips only done nodes before target", () => {
    const nodes = serialWorkflowNodes()
    const targetIndex = 2
    const snaps = snapshotMap(snapshotsFromWorkflowNodes(nodes))
    expect(shouldSkipNodeForResume(0, targetIndex, snaps.get("research-1"))).toBe(true)
    expect(shouldSkipNodeForResume(1, targetIndex, snaps.get("reasoning-2"))).toBe(true)
    expect(shouldSkipNodeForResume(2, targetIndex, snaps.get("reasoning-3"))).toBe(false)
  })

  it("restoreExecutionStateFromSnapshots aggregates prior node outputs", () => {
    const nodes = serialWorkflowNodes()
    const snapshots = snapshotsFromWorkflowNodes(nodes)
    const restored = restoreExecutionStateFromSnapshots(snapshots, nodes, "reasoning-3")
    expect(restored.results).toHaveLength(2)
    expect(restored.results[0]?.id).toBe("research-1")
    expect(restored.results[1]?.id).toBe("reasoning-2")
  })

  it("prepareNodesForPartialResume resets target and downstream error nodes", () => {
    const nodes = serialWorkflowNodes()
    const prepared = prepareNodesForPartialResume(nodes, "reasoning-3")
    expect(prepared[0]?.status).toBe("done")
    expect(prepared[1]?.status).toBe("done")
    expect(prepared[2]?.status).toBe("pending")
    expect(prepared[2]?.error).toBeUndefined()
  })

  it("assembleFinalFromResults builds canvas report from last reasoning output", () => {
    const nodes = serialWorkflowNodes()
    const snapshots = snapshotsFromWorkflowNodes(nodes)
    const restored = restoreExecutionStateFromSnapshots(snapshots, nodes, "reasoning-3")
    const final = assembleFinalFromResults(
      [
        ...restored.results,
        {
          id: "reasoning-3",
          ok: true,
          summary: "Final canvas assembled",
          output: { text: "Full Canvas Report: chapter plan ready.", finalResponse: "Full Canvas Report: chapter plan ready." },
        },
      ],
      "## References\n- Paper A"
    )
    expect(final).toContain("Full Canvas Report")
    expect(final).toContain("Paper A")
  })
})

describe("partial resume state machine simulation", () => {
  it("skips nodes 1-2 with DB snapshots and only executes node 3 on retry", () => {
    const nodes = serialWorkflowNodes()
    const dbSnapshots = snapshotsFromWorkflowNodes(nodes.filter((n) => n.status === "done"))
    const targetNodeId = "reasoning-3"
    const targetIndex = findTargetNodeIndex(nodes, targetNodeId)
    const byId = snapshotMap(dbSnapshots)

    const executed: string[] = []
    const skipped: string[] = []

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      if (shouldSkipNodeForResume(i, targetIndex, byId.get(n.id))) {
        skipped.push(n.id)
        continue
      }
      executed.push(n.id)
    }

    expect(skipped).toEqual(["research-1", "reasoning-2"])
    expect(executed).toEqual(["reasoning-3"])

    const restored = restoreExecutionStateFromSnapshots(dbSnapshots, nodes, targetNodeId)
    const final = assembleFinalFromResults(
      [
        ...restored.results,
        {
          id: "reasoning-3",
          ok: true,
          summary: "retry ok",
          output: { text: "Recovered final canvas after partial retry." },
        },
      ],
      ""
    )
    expect(final).toContain("Recovered final canvas")
  })
})

describe("AgentNode snapshot persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("upsertAgentNodeSnapshot writes outputs and nodeSnapshot", async () => {
    vi.mocked(prisma.agentNode.upsert).mockResolvedValueOnce({
      id: "an1",
      jobId: "job1",
      nodeId: "research-1",
      status: "done",
      outputs: { total: 3 },
      nodeSnapshot: { nodeType: "research" },
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    await upsertAgentNodeSnapshot("job1", {
      nodeId: "research-1",
      status: "done",
      outputs: { total: 3 },
      nodeSnapshot: { nodeType: "research", nodeIndex: 0, priorNodeIds: [] },
    })

    expect(prisma.agentNode.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId_nodeId: { jobId: "job1", nodeId: "research-1" } },
        create: expect.objectContaining({ outputs: { total: 3 } }),
      })
    )
  })

  it("loadAgentNodeSnapshots reads ordered snapshots for resume", async () => {
    vi.mocked(prisma.agentNode.findMany).mockResolvedValueOnce([
      {
        id: "an1",
        jobId: "job1",
        nodeId: "research-1",
        status: "done",
        outputs: { total: 2 },
        nodeSnapshot: { nodeIndex: 0 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "an2",
        jobId: "job1",
        nodeId: "reasoning-2",
        status: "done",
        outputs: { text: "step2" },
        nodeSnapshot: { nodeIndex: 1 },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const snaps = await loadAgentNodeSnapshots("job1")
    expect(snaps).toHaveLength(2)
    expect(snaps[0]?.nodeId).toBe("research-1")
    expect(snaps[1]?.outputs).toEqual({ text: "step2" })
  })

  it("persistAgentNodeSnapshotAsync swallows DB errors", async () => {
    vi.mocked(prisma.agentNode.upsert).mockRejectedValueOnce(new Error("db down"))
    await expect(
      persistAgentNodeSnapshotAsync("job1", { nodeId: "n1", status: "done", outputs: {} })
    ).resolves.toBeUndefined()
  })
})

describe("POST /api/agent/run partial resume", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("forwards targetNodeId and resumeNodes to runAgentOnServer", async () => {
    vi.mocked(prisma.agentJob.findFirst).mockResolvedValueOnce({
      id: "job1",
      userId: "user-test",
      status: "error",
      input: "test",
      provider: { providerId: "openai", model: "gpt-4" },
      checkpoint: JSON.parse(JSON.stringify({ phase: "running", nodes: serialWorkflowNodes() })),
      result: null,
      error: null,
      errorMessage: null,
      errorStack: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    runAgentOnServer.mockResolvedValueOnce({ final: "ok", nodes: [], sources: [] })

    const nodes = serialWorkflowNodes()
    const res = await POST(
      new Request("http://localhost/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userInput: "resume test",
          provider: { providerId: "openai", model: "gpt-4" },
          jobId: "job1",
          targetNodeId: "reasoning-3",
        }),
      })
    )

    expect(res.status).toBe(200)
    expect(runAgentOnServer).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job1",
        targetNodeId: "reasoning-3",
        resumeNodes: nodes,
      })
    )
  })
})
