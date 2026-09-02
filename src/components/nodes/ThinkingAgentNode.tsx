"use client"

import React, { memo, useEffect, useRef, useState } from "react"
import { Handle, type NodeProps, Position } from "reactflow"
import { BrainCircuit } from "lucide-react"

import { HumanInterventionPanel } from "@/components/human-intervention-panel"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

export type ThinkingAgentNodeData = {
  label: string
  status: string
  provider: string
  type: string
  logs: string[]
  active?: boolean
  error?: string
  metadata?: Record<string, unknown>
  thinkingText?: string
  finalResponse?: string
  thinkingComplete?: boolean
  onRetry?: (nodeId: string) => void
  retrying?: boolean
}

function statusClass(status: string) {
  switch (status) {
    case "running":
      return cn(
        "border-sky-400/60 bg-gradient-to-br from-sky-500/18 to-blue-600/10 text-foreground",
        "shadow-[0_0_0_1px_oklch(0.62_0.19_230/0.4),0_0_24px_oklch(0.55_0.2_250/0.35)]",
        "sk-node-running"
      )
    case "done":
      return cn(
        "border-emerald-500/55 bg-gradient-to-br from-emerald-500/16 to-emerald-600/8 text-emerald-50",
        "shadow-[0_0_0_1px_oklch(0.65_0.17_145/0.4),0_0_20px_oklch(0.62_0.17_145/0.28)]",
        "sk-node-done"
      )
    case "error":
      return cn(
        "border-rose-500/55 bg-gradient-to-br from-rose-500/16 to-rose-600/8 text-rose-50",
        "shadow-[0_0_0_1px_oklch(0.58_0.22_25/0.45),0_0_22px_oklch(0.55_0.2_25/0.32)]",
        "sk-node-error"
      )
    case "pending_approval":
      return cn(
        "animate-pulse border-amber-500 bg-amber-500/12 text-amber-50",
        "shadow-[0_0_0_1px_oklch(0.75_0.18_75/0.55),0_0_28px_oklch(0.72_0.17_75/0.42)]"
      )
    default:
      return "border-zinc-500/35 bg-background/35 text-muted-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.04)]"
  }
}

function ThinkingTerminal({
  thinkingText,
  thinkingComplete,
  isStreaming,
}: {
  thinkingText: string
  thinkingComplete: boolean
  isStreaming: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const hasThinking = thinkingText.length > 0

  useEffect(() => {
    if (!hasThinking || !isStreaming) return
    const frame = window.requestAnimationFrame(() => setExpanded(true))
    return () => window.cancelAnimationFrame(frame)
  }, [hasThinking, isStreaming])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !expanded) return
    el.scrollTop = el.scrollHeight
  }, [thinkingText, expanded])

  if (!hasThinking && !thinkingComplete) return null

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mb-1 flex w-full items-center justify-between font-mono text-[9px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
      >
        <span>深度思考终端</span>
        <span>{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded ? (
        <div
          ref={scrollRef}
          className={cn(
            "bg-zinc-950 border rounded font-mono text-xs p-2 max-h-32 overflow-y-auto transition-colors duration-500",
            thinkingComplete
              ? "border-emerald-800/80 shadow-[inset_0_0_12px_oklch(0.45_0.12_145/0.15)]"
              : "border-zinc-800"
          )}
        >
          <pre className="whitespace-pre-wrap break-words text-emerald-400/90 leading-relaxed">
            {thinkingText}
            {isStreaming && !thinkingComplete ? (
              <span className="ml-0.5 inline-block h-[1em] w-[0.45em] animate-pulse bg-emerald-400 align-[-0.1em]" />
            ) : null}
          </pre>
          {thinkingComplete ? (
            <div className="mt-1.5 flex items-center gap-1 font-mono text-[9px] text-emerald-500/90">
              <span aria-hidden>✓</span>
              <span>思维链组装完毕</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export const ThinkingAgentNode = memo(function ThinkingAgentNode({ data, id }: NodeProps<ThinkingAgentNodeData>) {
  const t = useT()
  const interventionNodeId = useAgentStore((s) => s.intervention.pendingNodeId)
  const interventionReason = useAgentStore((s) => s.intervention.reason)
  const nodeStatus = (data.status === "idle" ? "pending" : data.status) as string
  const energize = Boolean(data.active && data.status === "running")
  const showIntervention = nodeStatus === "pending_approval" && interventionNodeId === id && interventionReason
  const thinkingText = data.thinkingText ?? ""
  const thinkingComplete = Boolean(data.thinkingComplete)
  const isStreaming = data.status === "running" && thinkingText.length > 0 && !thinkingComplete
  const finalPreview = (data.finalResponse ?? "").trim()
  const showRetry = Boolean(data.onRetry && nodeStatus === "error")
  const isRetrying = Boolean(data.retrying)

  return (
    <div
      className={cn(
        "relative w-full min-w-0 max-w-[240px] rounded-sm border px-3 py-2 text-sm font-semibold tracking-wide transition-shadow duration-300",
        statusClass(nodeStatus),
        energize && "sk-node-energy"
      )}
    >
      {showIntervention ? <HumanInterventionPanel nodeId={id} reason={interventionReason} /> : null}
      <Handle type="target" position={Position.Left} className="!opacity-0 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!opacity-0 !border-0 !bg-transparent" />

      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border",
            data.status === "running"
              ? "border-sky-400/50 bg-sky-500/15 text-sky-300"
              : thinkingComplete
                ? "border-emerald-600/50 bg-emerald-500/15 text-emerald-300"
                : "border-zinc-600/50 bg-zinc-800/40 text-zinc-400"
          )}
        >
          <BrainCircuit className="h-3.5 w-3.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
            <span className="rounded-sm border border-border/60 bg-muted/10 px-1.5 py-0.5 text-[9px] uppercase">
              {data.status}
            </span>
            <span className="truncate text-[9px] opacity-80">
              {data.provider}/{data.type}
            </span>
          </div>
          <div className="mt-1 break-words leading-snug [overflow-wrap:anywhere]">{data.label}</div>
        </div>
      </div>

      <ThinkingTerminal
        thinkingText={thinkingText}
        thinkingComplete={thinkingComplete}
        isStreaming={isStreaming}
      />

      {finalPreview ? (
        <div className="mt-2 max-h-[88px] overflow-auto sk-scrollbar rounded-sm border border-border/40 bg-background/30 p-2 font-mono text-[10px] leading-snug text-foreground/85">
          <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">最终报告</div>
          <div className="whitespace-pre-wrap">{finalPreview}</div>
        </div>
      ) : null}

      {data.error ? (
        <div className="mt-2 whitespace-pre-wrap rounded-sm border border-rose-500/25 bg-rose-500/10 p-2 font-mono text-[10px] text-rose-100/90">
          {data.error}
        </div>
      ) : null}

      {showRetry ? (
        <button
          type="button"
          disabled={isRetrying}
          onClick={(e) => {
            e.stopPropagation()
            data.onRetry?.(id)
          }}
          className={cn(
            "absolute -right-2 top-1/2 z-20 -translate-y-1/2 translate-x-full",
            "flex items-center gap-1 rounded-sm border border-amber-400/50 bg-gradient-to-r from-amber-500/25 to-orange-500/20",
            "px-2 py-1 font-mono text-[9px] font-bold tracking-wide text-amber-50",
            "shadow-[0_0_16px_oklch(0.72_0.17_75/0.35)] transition-all hover:border-amber-300/70 hover:shadow-[0_0_22px_oklch(0.75_0.18_75/0.5)]",
            "disabled:cursor-not-allowed disabled:opacity-60",
            isRetrying && "sk-node-running animate-pulse"
          )}
        >
          {isRetrying ? "…" : t("topology.retry.node")}
        </button>
      ) : null}
    </div>
  )
})
