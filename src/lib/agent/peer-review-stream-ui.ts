import type { PeerReviewPersonaId } from "@/lib/agent/agent-personas"

export type PeerReviewStreamStyle = {
  border: string
  bg: string
  text: string
  label: string
}

export const PEER_REVIEW_STREAM_STYLES: Record<string, PeerReviewStreamStyle> = {
  methodology_critic: {
    border: "border-sky-500/40",
    bg: "bg-sky-500/10",
    text: "text-sky-100/95",
    label: "R1 · Methodology Critic",
  },
  innovation_scout: {
    border: "border-violet-500/40",
    bg: "bg-violet-500/10",
    text: "text-violet-100/95",
    label: "R2 · Innovation Scout",
  },
  area_chair: {
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/10",
    text: "text-emerald-100/95",
    label: "R3 · Area Chair",
  },
  debate: {
    border: "border-amber-500/40",
    bg: "bg-amber-500/10",
    text: "text-amber-100/95",
    label: "Debate Stream",
  },
}

export function peerReviewStreamStyle(streamId: string): PeerReviewStreamStyle {
  return (
    PEER_REVIEW_STREAM_STYLES[streamId] ?? {
      border: "border-border/50",
      bg: "bg-background/40",
      text: "text-muted-foreground",
      label: streamId,
    }
  )
}

export function readStreamDrafts(metadata: Record<string, unknown> | undefined): Record<string, string> {
  if (!metadata?.["streamDrafts"] || typeof metadata["streamDrafts"] !== "object") return {}
  const rec = metadata["streamDrafts"] as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(rec)) {
    if (typeof v === "string" && v.trim()) out[k] = v
  }
  return out
}

export function readStreamStatusLines(metadata: Record<string, unknown> | undefined): Record<string, string[]> {
  if (!metadata?.["streamStatusLines"] || typeof metadata["streamStatusLines"] !== "object") return {}
  const rec = metadata["streamStatusLines"] as Record<string, unknown>
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(rec)) {
    if (Array.isArray(v)) out[k] = v.filter((line): line is string => typeof line === "string")
  }
  return out
}

export function personaIdFromMetadata(metadata: Record<string, unknown> | undefined): PeerReviewPersonaId | null {
  const id = metadata?.["personaId"]
  if (id === "methodology_critic" || id === "innovation_scout" || id === "area_chair") return id
  return null
}
