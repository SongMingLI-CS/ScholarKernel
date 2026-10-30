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
  userId?: string
  jobId?: string
  nodeId: string
  reason: string
  resolve: (decision: HumanInterventionDecision) => void
  reject: (err: Error) => void
  createdAt: number
  cleanup: () => void
}

const gates = new Map<string, PendingGate>()

/** 注册挂起等待；由 intervention API 或测试 resolve。 */
export function waitForHumanIntervention(
  sessionId: string,
  nodeId: string,
  reason: string,
  signal?: AbortSignal,
  owner?: { userId: string; jobId: string }
): Promise<HumanInterventionDecision> {
  if (!sessionId.trim()) {
    return Promise.resolve({ action: "approve" })
  }

  if (gates.has(sessionId)) {
    return Promise.reject(new Error(`InterventionSessionBusy:${sessionId}`))
  }

  return new Promise<HumanInterventionDecision>((resolve, reject) => {
    const onAbort = () => {
      gates.delete(sessionId)
      reject(new DOMException("InterventionAborted", "AbortError"))
    }
    if (signal?.aborted) { onAbort(); return }
    const gate: PendingGate = { ...owner, nodeId, reason, resolve, reject, createdAt: Date.now(), cleanup: () => signal?.removeEventListener("abort", onAbort) }
    gates.set(sessionId, gate)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export function resolveHumanInterventionSession(
  sessionId: string,
  decision: HumanInterventionDecision,
  expected?: { userId: string; jobId: string; nodeId: string }
): { ok: true; nodeId: string } | { ok: false; error: string } {
  const gate = gates.get(sessionId)
  if (!gate) return { ok: false, error: "InterventionSessionNotFound" }
  if (expected && (gate.userId !== expected.userId || gate.jobId !== expected.jobId || gate.nodeId !== expected.nodeId)) return { ok: false, error: "InterventionNotAvailable" }
  gates.delete(sessionId)
  gate.cleanup()
  gate.resolve(decision)
  return { ok: true, nodeId: gate.nodeId }
}

export function getPendingIntervention(sessionId: string): Omit<PendingGate, "resolve" | "reject" | "cleanup"> | null {
  const gate = gates.get(sessionId)
  if (!gate) return null
  return { nodeId: gate.nodeId, reason: gate.reason, createdAt: gate.createdAt, userId: gate.userId, jobId: gate.jobId }
}

export function cancelHumanInterventionSession(sessionId: string, err?: Error) {
  const gate = gates.get(sessionId)
  if (!gate) return
  gates.delete(sessionId)
  gate.cleanup()
  gate.reject(err ?? new Error("InterventionCancelled"))
}

/** 测试专用：清空全局 gate 表。 */
export function resetHumanInterventionGatesForTests() {
  for (const [, gate] of gates) {
    gate.cleanup()
    gate.reject(new Error("InterventionReset"))
  }
  gates.clear()
}
