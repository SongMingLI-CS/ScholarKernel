import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { getAgentJobForUser, updateAgentJobWorkflowTopology } from "@/lib/agent-jobs"
import {
  resolveHumanInterventionSession,
  type HumanInterventionDecision,
} from "@/lib/agent/human-intervention-gate"
import { pruneWorkflowAfterHumanIntervention } from "@/lib/agent/human-intervention-pruning"
import type { WorkflowNode } from "@/lib/agent/planner"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"

type InterventionBody = {
  sessionId?: string
  jobId?: string
  nodeId?: string
  action?: "approve" | "redirect"
  instruction?: string
  workflowNodes?: WorkflowNode[]
}

function parseWorkflowNodes(raw: unknown): WorkflowNode[] | null {
  if (!Array.isArray(raw)) return null
  return raw as WorkflowNode[]
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const body = await parseJsonBody<InterventionBody>(req)
  if (!body) return jsonError("Invalid body", 400)

  const sessionId = body.sessionId?.trim()
  const nodeId = body.nodeId?.trim()
  const action = body.action

  if (!sessionId || !nodeId || (action !== "approve" && action !== "redirect")) {
    return jsonError("Invalid body: sessionId, nodeId, action required", 400)
  }

  if (action === "redirect" && !body.instruction?.trim()) {
    return jsonError("Invalid body: instruction required for redirect", 400)
  }

  let decision: HumanInterventionDecision = { action: "approve" }
  let prunedNodes: WorkflowNode[] | undefined

  if (action === "redirect") {
    const instruction = body.instruction!.trim()
    const baseNodes = parseWorkflowNodes(body.workflowNodes) ?? []
    if (baseNodes.length > 0) {
      const pruned = pruneWorkflowAfterHumanIntervention({
        nodes: baseNodes,
        breakpointNodeId: nodeId,
        instruction,
      })
      prunedNodes = pruned.nodes
    }
    decision = { action: "redirect", instruction, prunedNodes }
  }

  const resolved = resolveHumanInterventionSession(sessionId, decision)
  if (!resolved.ok) {
    return jsonError(resolved.error, 404)
  }

  if (body.jobId?.trim()) {
    const job = await getAgentJobForUser(body.jobId.trim(), userId)
    if (!job) return jsonError("Job not found", 404)

    const nodesToPersist =
      prunedNodes ??
      parseWorkflowNodes(body.workflowNodes) ??
      (Array.isArray((job.checkpoint as { nodes?: unknown })?.nodes)
        ? ((job.checkpoint as { nodes: unknown[] }).nodes as WorkflowNode[])
        : [])

    await updateAgentJobWorkflowTopology(job.id, nodesToPersist, {
      humanIntervention: {
        nodeId,
        action,
        instruction: body.instruction?.trim() ?? null,
        appliedAt: Date.now(),
      },
    })
  }

  return jsonOk({
    ok: true,
    nodeId: resolved.nodeId,
    action,
    prunedNodes: prunedNodes ?? null,
  })
}

export async function GET(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const sessionId = new URL(req.url).searchParams.get("sessionId")?.trim()
  if (!sessionId) return jsonError("sessionId required", 400)

  const { getPendingIntervention } = await import("@/lib/agent/human-intervention-gate")
  const pending = getPendingIntervention(sessionId)
  if (!pending) return jsonOk({ pending: false })

  return jsonOk({
    pending: true,
    nodeId: pending.nodeId,
    reason: pending.reason,
    createdAt: pending.createdAt,
  })
}
