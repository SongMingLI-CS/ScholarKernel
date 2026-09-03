export type EvidenceKind = "library" | "search" | "file"
export type EvidenceState = "loaded" | "missing" | "failed" | "degraded"

export type EvidenceStatus = {
  id: string
  kind: EvidenceKind
  label: string
  state: EvidenceState
  detail?: string
  sourceCount?: number
  nodeId?: string
}

export function mergeEvidenceStatuses(
  current: EvidenceStatus[] | undefined,
  incoming: EvidenceStatus[]
): EvidenceStatus[] {
  const merged = new Map((current ?? []).map((status) => [status.id, status]))
  for (const status of incoming) merged.set(status.id, status)
  return [...merged.values()]
}

export function evidenceStateTone(state: EvidenceState): "success" | "warning" | "error" {
  if (state === "loaded") return "success"
  if (state === "failed") return "error"
  return "warning"
}

export function hasDegradedEvidence(statuses: EvidenceStatus[] | undefined): boolean {
  return Boolean(statuses?.some((status) => status.state !== "loaded"))
}
