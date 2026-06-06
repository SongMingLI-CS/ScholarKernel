"use client"

import { memo } from "react"

import {
  peerReviewStreamStyle,
  personaIdFromMetadata,
  readStreamDrafts,
  readStreamStatusLines,
} from "@/lib/agent/peer-review-stream-ui"
import { cn } from "@/lib/utils"
import type { WorkflowNode } from "@/store/types"

function StreamPanel({
  streamId,
  draft,
  statusLines,
  compact,
}: {
  streamId: string
  draft?: string
  statusLines?: string[]
  compact?: boolean
}) {
  const style = peerReviewStreamStyle(streamId)
  const hasContent = Boolean(draft?.trim()) || Boolean(statusLines?.length)

  if (!hasContent) {
    return (
      <div className={cn("rounded-sm border px-2 py-1.5 font-mono text-[10px] opacity-60", style.border, style.bg, style.text)}>
        {style.label} · 等待输出…
      </div>
    )
  }

  return (
    <div className={cn("rounded-sm border px-2 py-1.5", style.border, style.bg)}>
      <div className={cn("font-mono text-[10px] font-semibold tracking-wide", style.text)}>{style.label}</div>
      {statusLines && statusLines.length > 0 ? (
        <div className={cn("mt-1 space-y-0.5 font-mono text-[10px] leading-snug", style.text)}>
          {statusLines.slice(-6).map((line, i) => (
            <div key={i} className="whitespace-pre-wrap opacity-90">
              {line}
            </div>
          ))}
        </div>
      ) : null}
      {draft?.trim() ? (
        <div
          className={cn(
            "mt-1 overflow-auto whitespace-pre-wrap font-mono leading-snug",
            compact ? "max-h-[72px] text-[9px]" : "max-h-[120px] text-[10px]",
            style.text
          )}
        >
          {draft}
        </div>
      ) : null}
    </div>
  )
}

export const PeerReviewStreamPanels = memo(function PeerReviewStreamPanels({
  nodes,
  streamIds,
  compact,
}: {
  nodes: WorkflowNode[]
  streamIds: string[]
  compact?: boolean
}) {
  const byPersona = new Map<string, WorkflowNode>()
  for (const n of nodes) {
    const pid = personaIdFromMetadata(n.metadata)
    if (pid) byPersona.set(pid, n)
  }

  return (
    <div className={cn("grid gap-2", streamIds.length > 1 ? "md:grid-cols-2" : "grid-cols-1")}>
      {streamIds.map((streamId) => {
        const node = byPersona.get(streamId as "methodology_critic" | "innovation_scout" | "area_chair")
        const drafts = readStreamDrafts(node?.metadata)
        const statusLines = readStreamStatusLines(node?.metadata)
        return (
          <StreamPanel
            key={streamId}
            streamId={streamId}
            draft={drafts[streamId]}
            statusLines={statusLines[streamId]}
            compact={compact}
          />
        )
      })}
    </div>
  )
})

export function isParallelPeerReviewActive(nodes: WorkflowNode[]): boolean {
  const r1 = nodes.find((n) => n.metadata?.personaId === "methodology_critic")
  const r2 = nodes.find((n) => n.metadata?.personaId === "innovation_scout")
  return Boolean(r1?.status === "running" && r2?.status === "running")
}
