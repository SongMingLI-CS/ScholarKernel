"use client"

import { memo, useEffect, useMemo, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { Cloud, Gauge, Zap } from "lucide-react"

import type { BillingMetricsPayload } from "@/lib/billing/billing-metrics"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { selectLastChatInference, useAgentStore } from "@/store/useAgentStore"

function inferSpeedTokPerSec(chars: number, totalMs: number, ttftMs: number | null): number | null {
  if (totalMs <= 0 || chars <= 0) return null
  const genMs = ttftMs != null ? Math.max(totalMs - ttftMs, 1) : totalMs
  return Math.round((chars / genMs) * 1000)
}

function formatUsd(value: number): string {
  if (value < 0.0001) return "$0.0000"
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(3)}`
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
  const [billing, setBilling] = useState<BillingMetricsPayload | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch("/api/user/billing-metrics", { cache: "no-store" })
        if (!res.ok) return
        const data = (await res.json()) as BillingMetricsPayload
        if (!cancelled) setBilling(data)
      } catch {
        // ignore polling errors
      }
    }
    void load()
    const timer = setInterval(load, 12_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [streaming?.active])

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
  const usagePercent = billing?.usagePercent ?? 0
  const quotaBarColor =
    usagePercent >= 95 ? "bg-rose-500" : usagePercent >= 80 ? "bg-amber-400" : "bg-emerald-400"

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

        {billing ? (
          <div className="mb-2 space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
              <span className="text-muted-foreground">{t("sidebar.cloudMetrics.quota")}</span>
              <span className={cn(usagePercent >= 95 ? "text-rose-300/90" : "text-cyan-200/90")}>
                {billing.tokenUsed.toLocaleString()} / {billing.tokenQuota.toLocaleString()}
              </span>
            </div>
            <div className="w-full rounded-full bg-gray-800 h-1.5 overflow-hidden">
              <div
                className={cn("h-1.5 rounded-full transition-all duration-500", quotaBarColor)}
                style={{ width: `${Math.min(100, usagePercent)}%` }}
              />
            </div>
            <div className="flex justify-between font-mono text-[9px] text-muted-foreground tabular-nums">
              <span>{t("sidebar.cloudMetrics.spent")}: {formatUsd(billing.totalSpent)}</span>
              <span>{usagePercent}%</span>
            </div>
          </div>
        ) : null}

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

        {billing && billing.recentJobs.length > 0 ? (
          <>
            <div className="my-2 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" aria-hidden />
            <div className="overflow-hidden">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {t("sidebar.cloudMetrics.recentJobs")}
              </div>
              <div className="relative h-[42px] overflow-hidden">
                <div className="sk-billing-ticker space-y-1">
                  {[...billing.recentJobs, ...billing.recentJobs].map((job, idx) => (
                    <div
                      key={`${job.jobId}-${idx}`}
                      className="flex items-center justify-between gap-2 font-mono text-[9px] tabular-nums text-muted-foreground"
                    >
                      <span className="truncate text-cyan-200/80">{job.jobId.slice(-8)}</span>
                      <span>
                        TTFT {job.ttftMs != null ? `${job.ttftMs}ms` : "—"}
                        <span className="mx-1 text-border/40">·</span>
                        <span className="text-amber-200/90">{formatUsd(job.costUsd)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
})
