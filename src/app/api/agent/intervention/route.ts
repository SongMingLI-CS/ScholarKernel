import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { getAgentJobForUser, updateAgentJobWorkflowTopology } from "@/lib/agent-jobs"
import {
  resolveHumanInterventionSession,
  type HumanInterventionDecision,
} from "@/lib/agent/human-intervention-gate"
import { pruneWorkflowAfterHumanIntervention } from "@/lib/agent/human-intervention-pruning"
import {
  isWorkflowInstructionWithinLimit,
  MAX_WORKFLOW_INSTRUCTION_CHARS,
  normalizeWorkflowNodes,
} from "@/lib/agent/workflow-node-guard"
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

  if (body.instruction !== undefined && !isWorkflowInstructionWithinLimit(body.instruction)) {
    return jsonError(
      `Invalid body: instruction exceeds ${MAX_WORKFLOW_INSTRUCTION_CHARS} characters`,
      400
    )
  }

  /**
   * `workflowNodes` 会被写进 `job.checkpoint.nodes`，之后被读回渲染拓扑、
   * 也被续跑当作真实计划。必须整批归一化，形状不成立就拒绝 —— 落库一个
   * `[{}]` 比返回 400 难排查得多。
   */
  let clientNodes: WorkflowNode[] | null = null
  if (body.workflowNodes !== undefined) {
    clientNodes = normalizeWorkflowNodes(body.workflowNodes)
    if (clientNodes === null) {
      return jsonError("Invalid body: workflowNodes", 400)
    }
  }

  let decision: HumanInterventionDecision = { action: "approve" }
  let prunedNodes: WorkflowNode[] | undefined

  if (action === "redirect") {
    const instruction = body.instruction!.trim()
    const baseNodes = clientNodes ?? []
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

  /**
   * 顺序很关键：**先**证明这个 job 属于当前用户，**再**去动门。
   * 旧实现先 resolve 门、后校验 jobId，于是「用自己合法的 jobId 走授权、
   * 拿别人的 sessionId 去唤醒」可以通吃别人的断点。
   */
  const requestedJobId = body.jobId?.trim()
  let job = null
  if (requestedJobId) {
    job = await getAgentJobForUser(requestedJobId, userId)
    if (!job) return jsonError("Job not found", 404)
    // 服务端挂起时 sessionId 恒等于 job.id（`interventionSessionId: job.id`）。
    // 两者不一致说明不是同一会话，直接拒绝而不是猜。
    if (sessionId !== job.id) {
      return jsonError("Invalid body: sessionId does not match jobId", 400)
    }
  }

  const resolved = resolveHumanInterventionSession(sessionId, decision, userId)
  if (!resolved.ok) {
    if (resolved.error === "InterventionSessionForbidden") {
      return jsonError(resolved.error, 403)
    }
    return jsonError(resolved.error, 404)
  }

  if (job) {
    const nodesToPersist =
      prunedNodes ??
      clientNodes ??
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
  const pending = getPendingIntervention(sessionId, userId)
  if (!pending) return jsonOk({ pending: false })

  return jsonOk({
    pending: true,
    nodeId: pending.nodeId,
    reason: pending.reason,
    createdAt: pending.createdAt,
  })
}
