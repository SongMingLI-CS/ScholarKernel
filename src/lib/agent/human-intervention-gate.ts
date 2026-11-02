import type { WorkflowNode } from "@/lib/agent/planner"

export type HumanInterventionDecision =
  | { action: "approve" }
  | { action: "redirect"; instruction: string; prunedNodes?: WorkflowNode[] }

export type InterventionPendingEvent = {
  nodeId: string
  status: "pending_approval"
  reason: string
  sessionId: string
}

type PendingGate = {
  nodeId: string
  reason: string
  resolve: (decision: HumanInterventionDecision) => void
  reject: (err: Error) => void
  createdAt: number
  /**
   * 挂起该断点的用户。生产路径上 sessionId 就是 jobId（`agent/jobs/route.ts`
   * 的 `interventionSessionId: job.id`），而 jobId 不是能力令牌 —— 它会出现在
   * 会话列表、日志、错误信息里。没有归属校验时，任何拿到别人 jobId 的登录用户
   * 都能替对方点「批准 / 改道」，并把自己的指令注入对方的审稿流程。
   * 缺省（undefined）表示无用户上下文的服务端内部调用，保持旧行为。
   */
  ownerId?: string
}

const gates = new Map<string, PendingGate>()

/** 注册挂起等待；由 intervention API 或测试 resolve。 */
export function waitForHumanIntervention(
  sessionId: string,
  nodeId: string,
  reason: string,
  signal?: AbortSignal,
  ownerId?: string
): Promise<HumanInterventionDecision> {
  if (signal?.aborted) return Promise.reject(new Error("InterventionAborted"))
  if (!sessionId.trim()) {
    return Promise.resolve({ action: "approve" })
  }

  if (gates.has(sessionId)) {
    return Promise.reject(new Error(`InterventionSessionBusy:${sessionId}`))
  }

  return new Promise<HumanInterventionDecision>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort)
    const gate: PendingGate = {
      nodeId,
      reason,
      createdAt: Date.now(),
      ownerId,
      resolve: (decision) => { cleanup(); resolve(decision) },
      reject: (error) => { cleanup(); reject(error) },
    }
    gates.set(sessionId, gate)

    const onAbort = () => {
      gates.delete(sessionId)
      gate.reject(new Error("InterventionAborted"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * 归属判定：门记录了属主时必须与请求者一致；未记录属主则不设限。
 * 注意**不能**在拒绝时删除门 —— 拒绝只是「这次不给你」，断点仍在等合法属主。
 */
function isOwnedBy(gate: PendingGate, requesterId: string | undefined): boolean {
  if (!gate.ownerId) return true
  return gate.ownerId === requesterId
}

export function resolveHumanInterventionSession(
  sessionId: string,
  decision: HumanInterventionDecision,
  requesterId?: string
): { ok: true; nodeId: string } | { ok: false; error: string } {
  const gate = gates.get(sessionId)
  if (!gate) return { ok: false, error: "InterventionSessionNotFound" }
  if (!isOwnedBy(gate, requesterId)) {
    return { ok: false, error: "InterventionSessionForbidden" }
  }
  gates.delete(sessionId)
  gate.resolve(decision)
  return { ok: true, nodeId: gate.nodeId }
}

export function getPendingIntervention(
  sessionId: string,
  requesterId?: string
): Omit<PendingGate, "resolve" | "reject"> | null {
  const gate = gates.get(sessionId)
  if (!gate) return null
  if (!isOwnedBy(gate, requesterId)) return null
  return { nodeId: gate.nodeId, reason: gate.reason, createdAt: gate.createdAt, ownerId: gate.ownerId }
}

export function cancelHumanInterventionSession(sessionId: string, err?: Error) {
  const gate = gates.get(sessionId)
  if (!gate) return
  gates.delete(sessionId)
  gate.reject(err ?? new Error("InterventionCancelled"))
}

/** 测试专用：清空全局 gate 表。 */
export function resetHumanInterventionGatesForTests() {
  for (const [, gate] of gates) {
    gate.reject(new Error("InterventionReset"))
  }
  gates.clear()
}
