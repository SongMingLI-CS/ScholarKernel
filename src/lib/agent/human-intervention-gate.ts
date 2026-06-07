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
}

const gates = new Map<string, PendingGate>()

/** 注册挂起等待；由 intervention API 或测试 resolve。 */
export function waitForHumanIntervention(
  sessionId: string,
  nodeId: string,
  reason: string,
  signal?: AbortSignal
): Promise<HumanInterventionDecision> {
  if (!sessionId.trim()) {
    return Promise.resolve({ action: "approve" })
  }

  if (gates.has(sessionId)) {
    return Promise.reject(new Error(`InterventionSessionBusy:${sessionId}`))
  }

  return new Promise<HumanInterventionDecision>((resolve, reject) => {
    const gate: PendingGate = { nodeId, reason, resolve, reject, createdAt: Date.now() }
    gates.set(sessionId, gate)

    const onAbort = () => {
      gates.delete(sessionId)
      reject(new Error("InterventionAborted"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export function resolveHumanInterventionSession(
  sessionId: string,
  decision: HumanInterventionDecision
): { ok: true; nodeId: string } | { ok: false; error: string } {
  const gate = gates.get(sessionId)
  if (!gate) return { ok: false, error: "InterventionSessionNotFound" }
  gates.delete(sessionId)
  gate.resolve(decision)
  return { ok: true, nodeId: gate.nodeId }
}

export function getPendingIntervention(sessionId: string): Omit<PendingGate, "resolve" | "reject"> | null {
  const gate = gates.get(sessionId)
  if (!gate) return null
  return { nodeId: gate.nodeId, reason: gate.reason, createdAt: gate.createdAt }
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
