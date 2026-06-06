import type { AgentJobCheckpoint } from "@/lib/agent-jobs"

export type PeerReviewStage = "r1" | "r2" | "debate" | "r3"

export type PeerReviewCheckpointData = {
  version: 1
  subject: string
  methodologyReview?: string
  innovationReview?: string
  debate?: string
  metaReview?: string
  completedStages: PeerReviewStage[]
}

export function parsePeerReviewCheckpoint(checkpoint: unknown): PeerReviewCheckpointData | null {
  if (!checkpoint || typeof checkpoint !== "object") return null
  const rec = checkpoint as Record<string, unknown>
  const pr = rec["peerReview"]
  if (!pr || typeof pr !== "object") return null
  const p = pr as Record<string, unknown>
  if (p["version"] !== 1) return null
  if (typeof p["subject"] !== "string") return null
  return {
    version: 1,
    subject: p["subject"],
    methodologyReview: typeof p["methodologyReview"] === "string" ? p["methodologyReview"] : undefined,
    innovationReview: typeof p["innovationReview"] === "string" ? p["innovationReview"] : undefined,
    debate: typeof p["debate"] === "string" ? p["debate"] : undefined,
    metaReview: typeof p["metaReview"] === "string" ? p["metaReview"] : undefined,
    completedStages: Array.isArray(p["completedStages"])
      ? p["completedStages"].filter(
          (s): s is PeerReviewStage => s === "r1" || s === "r2" || s === "debate" || s === "r3"
        )
      : [],
  }
}

export function isStageComplete(
  cp: PeerReviewCheckpointData | null | undefined,
  stage: PeerReviewStage
): boolean {
  return Boolean(cp?.completedStages.includes(stage))
}

export function mergePeerReviewCheckpoint(
  base: PeerReviewCheckpointData | null,
  patch: Partial<PeerReviewCheckpointData> & { markComplete?: PeerReviewStage }
): PeerReviewCheckpointData {
  const completed = new Set<PeerReviewStage>(base?.completedStages ?? [])
  if (patch.markComplete) completed.add(patch.markComplete)
  for (const s of patch.completedStages ?? []) completed.add(s)

  return {
    version: 1,
    subject: patch.subject ?? base?.subject ?? "",
    methodologyReview: patch.methodologyReview ?? base?.methodologyReview,
    innovationReview: patch.innovationReview ?? base?.innovationReview,
    debate: patch.debate ?? base?.debate,
    metaReview: patch.metaReview ?? base?.metaReview,
    completedStages: [...completed],
  }
}

export function peerReviewCheckpointToJobPatch(
  data: PeerReviewCheckpointData
): Pick<AgentJobCheckpoint, "peerReview" | "phase"> {
  return { phase: "running", peerReview: data }
}
