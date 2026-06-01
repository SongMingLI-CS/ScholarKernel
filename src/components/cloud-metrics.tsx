"use client"

import { memo, useMemo } from "react"
import type { ComponentType, ReactNode } from "react"
import { Cloud, Gauge, Zap } from "lucide-react"

import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { selectLastChatInference, useAgentStore } from "@/store/useAgentStore"

function inferSpeedTokPerSec(chars: number, totalMs: number, ttftMs: number | null): number | null {
  if (totalMs <= 0 || chars <= 0) return null
  const genMs = ttftMs != null ? Math.max(totalMs - ttftMs, 1) : totalMs
  return Math.round((chars / genMs) * 1000)
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: ReactNode
}) {
  return (
    <div className="relative flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-border/50 bg-background/50",
            "shadow-[0_0_12px_oklch(0.72_0.16_200/0.12)]"
          )}
        >
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <span className="truncate font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="min-w-0 font-mono text-[10px] leading-tight">{value}</div>
    </div>
  )
}

export const CloudMetrics = memo(function CloudMetrics() {
  const t = useT()
  const streaming = useAgentStore((s) => s.inference.streaming)
  const lastChatInference = useAgentStore(selectLastChatInference)

  const metrics = useMemo(() => {
    if (streaming?.active) {
      return {
        ttftMs: streaming.ttftMs,
        speed: inferSpeedTokPerSec(streaming.chars, streaming.totalMs, streaming.ttftMs),
      }
    }
    if (lastChatInference) {
      return {
        ttftMs: lastChatInference.ttftMs,
        speed: inferSpeedTokPerSec(lastChatInference.chars, lastChatInference.totalMs, lastChatInference.ttftMs),
      }
    }
    return { ttftMs: null as number | null, speed: null as number | null }
  }, [lastChatInference, streaming])

  const ttftLabel = metrics.ttftMs == null ? "—" : `${metrics.ttftMs}ms`
  const speedLabel = metrics.speed == null ? "—" : `${metrics.speed} tok/s`

  return (
    <div className="grid gap-2">
      <div className="relative overflow-hidden rounded-sm border border-emerald-500/25 bg-background/25 px-3 py-2.5 shadow-[inset_0_0_0_1px_oklch(0.72_0.19_145/0.08),0_0_32px_oklch(0.72_0.19_145/0.06)]">
        <div className="pointer-events-none absolute inset-0 opacity-35 mix-blend-screen" aria-hidden>
          <div className="sk-monitor-scan" />
        </div>

        <MetricRow
          icon={Cloud}
          label={t("sidebar.cloudMetrics.status")}
          value={
            <span className="inline-flex items-center gap-1.5 text-emerald-300/95">
              <span className="relative inline-flex h-2 w-2 shrink-0">
                <span className="absolute inset-0 rounded-full bg-emerald-400 sk-conn-dot" aria-hidden />
                <span className="absolute inset-0 rounded-full bg-emerald-400/60 animate-ping" aria-hidden />
              </span>
              <span className="font-semibold tracking-wide">{t("sidebar.cloudMetrics.online")}</span>
            </span>
          }
        />

        <div className="my-2 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" aria-hidden />

        <MetricRow
          icon={Gauge}
          label={t("sidebar.cloudMetrics.performance")}
          value={
            <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 tabular-nums">
              <span className="text-muted-foreground">{t("chat.ttft")}</span>
              <span className="text-cyan-200/90">{ttftLabel}</span>
              <span className="text-border/40">·</span>
              <span className="inline-flex items-center gap-1">
                <Zap className="h-3 w-3 text-amber-300/80" aria-hidden />
                <span className="text-muted-foreground">{t("sidebar.cloudMetrics.speed")}</span>
                <span className="text-amber-200/90">{speedLabel}</span>
              </span>
            </span>
          }
        />
      </div>
    </div>
  )
})
