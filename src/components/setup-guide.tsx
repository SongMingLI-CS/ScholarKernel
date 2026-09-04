"use client"

import { memo, useCallback, useMemo, useState, type ReactNode } from "react"
import { Cloud, Cpu, Terminal, Wrench } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/locales"
import { validateStoredProvider } from "@/lib/provider-api"
import { cn } from "@/lib/utils"

type GuideTab = "cloud" | "ollama"

type DiagState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ok"; latencyMs: number; detail?: string }
  | { status: "down"; reason: "ECONNREFUSED" | "CORS" | "TIMEOUT" | "UNKNOWN"; detail: string }

type CloudDiagItem = {
  id: "deepseek" | "anthropic"
  status: "idle" | "running" | "ok" | "http_error" | "network_error"
  latencyMs?: number
  httpStatus?: number
  detail?: string
}

function badgeClass(kind: "ok" | "warn" | "down") {
  if (kind === "ok") return "border-emerald-500/35 bg-emerald-500/[0.08] text-emerald-200/90"
  if (kind === "warn") return "border-amber-500/35 bg-amber-500/[0.08] text-amber-200/90"
  return "border-rose-500/35 bg-rose-500/[0.08] text-rose-200/90"
}

function readErrorCode(e: unknown): string | undefined {
  if (!e || typeof e !== "object") return undefined
  const rec = e as Record<string, unknown>
  if (typeof rec.code === "string") return rec.code
  if (rec.cause && typeof rec.cause === "object") {
    const cause = rec.cause as Record<string, unknown>
    if (typeof cause.code === "string") return cause.code
  }
  return undefined
}

function classifyOllamaDiagError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e ?? "")
  const lower = msg.toLowerCase()
  const code = readErrorCode(e) ?? ""

  const isTimeout =
    lower.includes("aborted") || lower.includes("timeout") || code === "ABORT_ERR" || code === "ETIMEDOUT"
  const isConnRefused = code === "ECONNREFUSED" || lower.includes("econnrefused") || lower.includes("connect econnrefused")
  const isCorsLike =
    lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed") || lower.includes("cors")

  return {
    reason: isConnRefused ? ("ECONNREFUSED" as const) : isTimeout ? ("TIMEOUT" as const) : isCorsLike ? ("CORS" as const) : ("UNKNOWN" as const),
    detail: msg,
    code: code || undefined,
  }
}

function StepItem({
  idx,
  title,
  body,
}: {
  idx: number
  title: string
  body: ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/30 font-mono text-[11px] text-muted-foreground">
        {idx}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold tracking-wide">{title}</div>
        <div className="mt-1 text-sm leading-relaxed text-foreground/90">{body}</div>
      </div>
    </li>
  )
}

export const SetupGuide = memo(function SetupGuide({ compact }: { compact?: boolean }) {
  const t = useT()
  const [tab, setTab] = useState<GuideTab>("cloud")
  const [diag, setDiag] = useState<DiagState>({ status: "idle" })
  const [cloudDiag, setCloudDiag] = useState<CloudDiagItem[]>([
    { id: "deepseek", status: "idle" },
    { id: "anthropic", status: "idle" },
  ])

  const tabs = useMemo(
    () =>
      [
        { id: "cloud" as const, icon: Cloud, label: t("setup.tab.cloud") },
        { id: "ollama" as const, icon: Cpu, label: t("setup.tab.ollama") },
      ] as const,
    [t]
  )

  const runDiag = useCallback(async () => {
    if (diag.status === "running") return
    setDiag({ status: "running" })
    const startedAt = performance.now()
    try {
      const ctrl = new AbortController()
      const timeout = window.setTimeout(() => ctrl.abort(), 1400)
      const res = await fetch("http://localhost:11434/api/tags", {
        method: "GET",
        mode: "cors",
        cache: "no-store",
        signal: ctrl.signal,
      })
      window.clearTimeout(timeout)
      const latencyMs = Math.round(performance.now() - startedAt)
      if (!res.ok) {
        const text = await res.text().catch(() => "")
        setDiag({ status: "down", reason: "UNKNOWN", detail: `HTTP ${res.status} ${text || res.statusText}` })
        return
      }
      setDiag({ status: "ok", latencyMs })
    } catch (e) {
      const c = classifyOllamaDiagError(e)
      console.error("[SetupGuide] Ollama connectivity check failed", { ...c, error: e })
      setDiag({ status: "down", reason: c.reason, detail: c.code ? `${c.reason}(${c.code}): ${c.detail}` : `${c.reason}: ${c.detail}` })
    }
  }, [diag.status])

  const diagBadge = useMemo(() => {
    if (diag.status === "idle") return { cls: "border-border/60 bg-background/25 text-muted-foreground", text: t("setup.diag.badge.idle") }
    if (diag.status === "running") return { cls: badgeClass("warn"), text: t("setup.diag.badge.running") }
    if (diag.status === "ok") return { cls: badgeClass("ok"), text: `${t("setup.diag.badge.ok")} · ${diag.latencyMs}ms` }
    const key =
      diag.reason === "ECONNREFUSED"
        ? "setup.diag.badge.refused"
        : diag.reason === "CORS"
          ? "setup.diag.badge.cors"
          : diag.reason === "TIMEOUT"
            ? "setup.diag.badge.timeout"
            : "setup.diag.badge.unknown"
    return { cls: badgeClass("down"), text: t(key) }
  }, [diag, t])

  const runCloudDiag = useCallback(async () => {
    // reset -> running
    setCloudDiag([
      { id: "deepseek", status: "running" },
      { id: "anthropic", status: "running" },
    ])

    const probe = async (id: CloudDiagItem["id"]): Promise<CloudDiagItem> => {
      const startedAt = performance.now()
      const ctrl = new AbortController()
      const timeout = window.setTimeout(() => ctrl.abort(), 1800)
      try {
        const res =
          id === "deepseek"
            ? await validateStoredProvider("deepseek_openai_compat", "deepseek-chat", {
                signal: ctrl.signal,
              })
            : await validateStoredProvider("anthropic", "claude-3-5-haiku-20241022", {
                signal: ctrl.signal,
              })
        window.clearTimeout(timeout)
        const latencyMs = Math.round(performance.now() - startedAt)
        if (res.ok) return { id, status: "ok", latencyMs, httpStatus: res.status }

        const detail = res.detail ?? res.kind ?? "error"
        const isNet = res.kind === "cors" || res.kind === "unknown"
        return {
          id,
          status: isNet ? "network_error" : "http_error",
          latencyMs: res.latencyMs,
          httpStatus: res.status,
          detail: typeof detail === "string" ? detail : String(detail),
        }
      } catch (e) {
        window.clearTimeout(timeout)
        const msg = e instanceof Error ? e.message : String(e ?? "")
        return { id, status: "network_error", detail: msg }
      }
    }

    const [deepseek, anthropic] = await Promise.all([probe("deepseek"), probe("anthropic")])
    setCloudDiag([deepseek, anthropic])
  }, [])

  const explainHttpStatus = useCallback(
    (s: number | undefined) => {
      if (!s) return t("setup.net.explain.unknown")
      if (s === 401 || s === 403) return t("setup.net.explain.401")
      if (s === 400) return t("setup.net.explain.400")
      if (s === 404) return t("setup.net.explain.404")
      if (s >= 500) return t("setup.net.explain.5xx")
      return t("setup.net.explain.other")
    },
    [t]
  )

  return (
    <div className={cn("w-full font-mono", compact && "text-[13px]")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-semibold tracking-wide">{t("setup.title")}</div>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{t("setup.subtitle")}</div>
        </div>
        <span className={cn("inline-flex items-center gap-2 rounded-sm border px-3 py-2 text-[11px]", diagBadge.cls)}>
          <Wrench className="h-4 w-4" />
          <span className="truncate">{diagBadge.text}</span>
        </span>
      </div>

      <div className="mt-4 rounded-xl border border-border/60 bg-background/20 p-2">
        <div className="grid gap-2 sm:grid-cols-2">
          {tabs.map((it) => {
            const Icon = it.icon
            const active = tab === it.id
            return (
              <Button
                key={it.id}
                type="button"
                variant="outline"
                className={cn(
                  "h-10 justify-start gap-2 rounded-sm border-dashed border-border/60 bg-background/25 font-mono text-[13px] hover:bg-background/50",
                  active && "border-sidebar-primary/50 bg-sidebar-primary/10 shadow-[inset_0_0_0_1px_oklch(0.488_0.243_264.376/0.35)]"
                )}
                onClick={() => setTab(it.id)}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{it.label}</span>
              </Button>
            )
          })}
        </div>
      </div>

      {tab === "cloud" ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-dashed border-border/60 bg-background/25 p-4">
            <div className="text-xs font-semibold tracking-wider text-muted-foreground">{t("setup.cloud.title")}</div>
            <ol className="mt-3 space-y-4">
              <StepItem
                idx={1}
                title={t("setup.cloud.step1.title")}
                body={<span>{t("setup.cloud.step1.body")}</span>}
              />
              <StepItem
                idx={2}
                title={t("setup.cloud.step2.title")}
                body={<span>{t("setup.cloud.step2.body")}</span>}
              />
              <StepItem
                idx={3}
                title={t("setup.cloud.step3.title")}
                body={<span>{t("setup.cloud.step3.body")}</span>}
              />
            </ol>
          </div>

          <div className="rounded-xl border border-dashed border-border/60 bg-background/20 p-4 text-xs text-muted-foreground">
            {t("setup.cloud.note")}
          </div>

          <div className="rounded-xl border border-border/60 bg-background/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-wider text-muted-foreground">{t("setup.net.title")}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t("setup.net.subtitle")}</div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="gap-2 border-dashed border-border/60 bg-background/25"
                onClick={runCloudDiag}
              >
                <Wrench className="h-4 w-4" />
                {t("setup.net.btn")}
              </Button>
            </div>

            <div className="mt-3 grid gap-2">
              {cloudDiag.map((it) => {
                const label = it.id === "deepseek" ? "DeepSeek" : "Anthropic"
                const statusText =
                  it.status === "idle"
                    ? t("setup.net.state.idle")
                    : it.status === "running"
                      ? t("setup.net.state.running")
                      : it.status === "ok"
                        ? `${t("setup.net.state.ok")} · ${it.latencyMs ?? "—"}ms`
                        : it.status === "http_error"
                          ? `${t("setup.net.state.http")} · ${it.httpStatus ?? "—"}`
                          : t("setup.net.state.neterr")

                return (
                  <div key={it.id} className="rounded-lg border border-border/60 bg-background/20 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold tracking-wide text-foreground/90">{label}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{statusText}</span>
                    </div>
                    {it.status === "http_error" ? (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {explainHttpStatus(it.httpStatus)}{" "}
                        <span className="break-words font-mono text-foreground/80">{it.detail ?? ""}</span>
                      </div>
                    ) : null}
                    {it.status === "network_error" ? (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {t("setup.net.explain.network")}{" "}
                        <span className="break-words font-mono text-foreground/80">{it.detail ?? ""}</span>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      {tab === "ollama" ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-dashed border-border/60 bg-background/25 p-4">
            <div className="text-xs font-semibold tracking-wider text-muted-foreground">{t("setup.ollama.title")}</div>
            <ol className="mt-3 space-y-4">
              <StepItem idx={1} title={t("setup.ollama.step1.title")} body={<span>{t("setup.ollama.step1.body")}</span>} />
              <StepItem
                idx={2}
                title={t("setup.ollama.step2.title")}
                body={
                  <div className="space-y-2">
                    <div>{t("setup.ollama.step2.body")}</div>
                    <pre className="overflow-x-auto rounded-lg border border-border/60 bg-background/30 p-3 text-[11px] leading-relaxed text-foreground/90">
                      {"launchctl setenv OLLAMA_ORIGINS \"http://localhost:3000\""}
                    </pre>
                    <div className="text-xs text-muted-foreground">{t("setup.ollama.step2.hint")}</div>
                  </div>
                }
              />
              <StepItem
                idx={3}
                title={t("setup.ollama.step3.title")}
                body={
                  <div className="space-y-2">
                    <div>{t("setup.ollama.step3.body")}</div>
                    <pre className="overflow-x-auto rounded-lg border border-border/60 bg-background/30 p-3 text-[11px] leading-relaxed text-foreground/90">
                      ollama run deepseek-v2
                    </pre>
                  </div>
                }
              />
            </ol>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-wider text-muted-foreground">{t("setup.diag.title")}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t("setup.diag.subtitle")}</div>
              </div>
              <Button type="button" variant="outline" className="gap-2 border-dashed border-border/60 bg-background/25" onClick={runDiag}>
                <Wrench className="h-4 w-4" />
                {t("setup.diag.btn")}
              </Button>
            </div>

            {diag.status === "down" ? (
              <div className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-100/90">
                <div className="font-semibold">{t("setup.diag.downTitle")}</div>
                <div className="mt-2 break-words font-mono text-[11px] opacity-95">{diag.detail}</div>
              </div>
            ) : null}

            {diag.status === "ok" ? (
              <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3 text-xs text-emerald-100/90">
                <div className="font-semibold">{t("setup.diag.okTitle")}</div>
                <div className="mt-2 text-[11px] opacity-95">{t("setup.diag.okDetail")}</div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
})
