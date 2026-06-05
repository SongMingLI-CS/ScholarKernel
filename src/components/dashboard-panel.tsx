"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Activity } from "lucide-react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { FeatureManifest } from "@/components/feature-manifest"
import { SetupGuide } from "@/components/setup-guide"
import { Button } from "@/components/ui/button"
import { TopologyView } from "@/components/topology-view"
import { useT } from "@/lib/locales"
import { useAgentStore } from "@/store/useAgentStore"

export const DashboardPanel = memo(function DashboardPanel() {
  const t = useT()
  const topology = useAgentStore((s) => s.topology)
  const active = useAgentStore((s) => s.providers.active)
  const last = useAgentStore((s) => s.inference.last)
  const streaming = useAgentStore((s) => s.inference.streaming)
  const history = useAgentStore((s) => s.inference.history)
  const [setupOpen, setSetupOpen] = useState(false)

  const chartRows = useMemo(() => {
    return history.map((m, i) => {
      const tps = m.totalMs > 0 ? Math.round((m.chars / m.totalMs) * 1000) : 0
      return {
        idx: i + 1,
        ttft: m.ttftMs ?? 0,
        tps,
        ok: m.ok,
      }
    })
  }, [history])

  const isEmpty = history.length === 0 && !last && !streaming?.active

  useEffect(() => {
    if (!setupOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSetupOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setupOpen])

  if (isEmpty) {
    return (
      <div className="mx-auto flex min-h-[72dvh] w-full max-w-[1200px] items-center px-4 py-8">
        <div className="w-full space-y-4">
          <FeatureManifest className="w-full" />
          <div className="flex justify-center">
            <Button
              className="gap-2 rounded-sm font-mono"
              onClick={() => setSetupOpen(true)}
            >
              {t("dashboard.setupGuide.btn")}
            </Button>
          </div>
        </div>

        {setupOpen ? (
          <div className="fixed inset-0 z-[70]">
            <button
              type="button"
              className="absolute inset-0 bg-black/55 backdrop-blur-sm"
              aria-label="close"
              onClick={() => setSetupOpen(false)}
            />
            <div className="relative mx-auto flex min-h-dvh max-w-[920px] items-center px-4 py-10">
              <div
                className="w-full overflow-hidden rounded-2xl border border-border/60 bg-background/85 shadow-[0_0_0_1px_oklch(0.488_0.243_264.376/0.18),0_30px_120px_oklch(0_0_0/0.55)]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="sk-setup-guide-title"
              >
                <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                  <div className="min-w-0">
                    <div id="sk-setup-guide-title" className="font-mono text-sm font-semibold tracking-wide text-foreground/95">
                      {t("setup.modal.title")}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {t("setup.modal.subtitle")}
                    </div>
                  </div>
                  <Button variant="outline" className="border-border/60 bg-background/30" onClick={() => setSetupOpen(false)}>
                    {t("setup.modal.close")}
                  </Button>
                </div>
                <div className="max-h-[78vh] overflow-auto sk-scrollbar px-5 py-4">
                  <SetupGuide compact />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <div className="font-mono text-sm font-semibold tracking-wide text-foreground/95">{t("dashboard.title")}</div>
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted-foreground">
            {t("dashboard.subtitle")}
          </div>
        </div>
      </div>

      {/* mini status bar */}
      <div className="mt-4 rounded-sm border border-border/60 bg-background/35 px-3 py-2 font-mono text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-foreground/90">
            {t("dashboard.active")}
          </span>
          <span className="truncate">
            {active.providerId} · {active.model}
          </span>
          {streaming?.active ? (
            <span className="text-emerald-300/90">
              {t("dashboard.live")} · {t("chat.ttft")} {streaming.ttftMs == null ? "—" : `${streaming.ttftMs}ms`} · {streaming.chars} {t("models.chars")}
            </span>
          ) : null}
          {last ? (
            <span className="text-foreground/80">
              {t("dashboard.last")} · {last.ok ? "OK" : "ERR"} · {t("chat.ttft")} {last.ttftMs ?? "—"}ms · {last.totalMs}ms
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-sm border border-border/60 bg-card/25 p-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{t("dashboard.ttftTrend")}</span>
            <span className="text-emerald-400/80">ms</span>
          </div>
          <div className="h-[120px] w-full">
            {chartRows.length === 0 ? (
              <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted-foreground">
                {t("dashboard.noHistory")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="oklch(1 0 0 / 0.06)" vertical={false} />
                  <XAxis dataKey="idx" tick={{ fill: "oklch(0.65 0 0)", fontSize: 10, fontFamily: "var(--font-mono)" }} />
                  <YAxis
                    width={32}
                    tick={{ fill: "oklch(0.65 0 0)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--background)",
                      border: "1px solid oklch(1 0 0 / 0.12)",
                      borderRadius: 2,
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                    }}
                    labelFormatter={(v) => `Run #${v}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="ttft"
                    stroke="oklch(0.72 0.19 145)"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-sm border border-border/60 bg-card/25 p-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>{t("dashboard.throughput")}</span>
            <span className="text-amber-300/80">c/s</span>
          </div>
          <div className="h-[120px] w-full">
            {chartRows.length === 0 ? (
              <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted-foreground">
                {t("dashboard.afterChat")}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartRows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="oklch(1 0 0 / 0.06)" vertical={false} />
                  <XAxis dataKey="idx" tick={{ fill: "oklch(0.65 0 0)", fontSize: 10, fontFamily: "var(--font-mono)" }} />
                  <YAxis
                    width={36}
                    tick={{ fill: "oklch(0.65 0 0)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--background)",
                      border: "1px solid oklch(1 0 0 / 0.12)",
                      borderRadius: 2,
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                    }}
                    labelFormatter={(v) => `Run #${v}`}
                  />
                  <Line type="monotone" dataKey="tps" stroke="oklch(0.78 0.16 75)" strokeWidth={1.5} dot={false} isAnimationActive />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 h-[520px] min-h-[500px] w-full">
        <TopologyView topology={topology} />
      </div>
    </div>
  )
})
