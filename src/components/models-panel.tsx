"use client"

import type { ComponentType } from "react"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Cpu, Gauge, Globe2, KeyRound, LoaderCircle, Server } from "lucide-react"

import { Button } from "@/components/ui/button"
import { validateProvider } from "@/lib/ai-gateway"
import { useT, type LocaleKey } from "@/lib/locales"
import { isLikelyCorsBlocked } from "@/lib/network-errors"
import { cn } from "@/lib/utils"
import { getRuntimeKeyForProvider, useAgentStore, type ProviderId } from "@/store/useAgentStore"

type ProviderOption = {
  id: ProviderId
  titleKey: LocaleKey
  subtitleKey: LocaleKey
  icon: ComponentType<{ className?: string }>
}

const OPTIONS: readonly ProviderOption[] = [
  {
    id: "ollama",
    titleKey: "models.opt.ollama.title",
    subtitleKey: "models.opt.ollama.subtitle",
    icon: Server,
  },
  {
    id: "openai",
    titleKey: "models.opt.openai.title",
    subtitleKey: "models.opt.openai.subtitle",
    icon: Globe2,
  },
  {
    id: "deepseek_openai_compat",
    titleKey: "models.opt.deepseek.title",
    subtitleKey: "models.opt.deepseek.subtitle",
    icon: Globe2,
  },
  {
    id: "anthropic",
    titleKey: "models.opt.anthropic.title",
    subtitleKey: "models.opt.anthropic.subtitle",
    icon: Cpu,
  },
  {
    id: "google",
    titleKey: "models.opt.google.title",
    subtitleKey: "models.opt.google.subtitle",
    icon: Cpu,
  },
] as const

function normalizeBaseUrl(baseUrl?: string) {
  if (!baseUrl) return ""
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

function defaultConfigForProvider(id: ProviderId) {
  if (id === "ollama") return { baseUrl: "http://localhost:11434", model: "llama3.1" }
  if (id === "openai") return { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" }
  if (id === "deepseek_openai_compat") return { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" }
  if (id === "anthropic") return { baseUrl: "https://api.anthropic.com", model: "claude-3-5-sonnet-latest" }
  if (id === "google") return { baseUrl: "https://generativelanguage.googleapis.com", model: "gemini-2.0-flash" }
  return { baseUrl: "", model: "" }
}

function runtimeKeyForProvider(runtimeKeys: ReturnType<typeof useAgentStore.getState>["runtimeKeys"], id: ProviderId) {
  const key = getRuntimeKeyForProvider(runtimeKeys, id)
  return key || undefined
}

function connKey(providerId: ProviderId, baseUrl: string, model: string) {
  return `${providerId}::${normalizeBaseUrl(baseUrl)}::${(model ?? "").trim()}`
}

function connErrorText(t: (k: LocaleKey) => string, code: string | undefined) {
  if (!code) return "—"
  const key = `conn.err.${code}` as LocaleKey
  const localized = t(key)
  return localized === key ? code : localized
}

function formatTs(ts: number, lang: "zh" | "en") {
  const d = new Date(ts)
  return d.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function providerName(t: (k: LocaleKey) => string, providerId: ProviderId) {
  const key = `provider.name.${providerId}` as LocaleKey
  const localized = t(key)
  return localized === key ? providerId : localized
}

async function probeDraftProvider(input: {
  providerId: ProviderId
  model: string
  baseUrl: string
  runtimeKeys: ReturnType<typeof useAgentStore.getState>["runtimeKeys"]
}) {
  const base = normalizeBaseUrl(input.baseUrl)
  const model = (input.model ?? "").trim()
  if (!model) throw new Error("EmptyModel")

  if (input.providerId === "ollama") {
    const b = base || "http://localhost:11434"
    await fetch(`${b}/api/tags`, { method: "GET", mode: "cors", cache: "no-store" })
    return
  }

  const res = await validateProvider(input.providerId, model, {
    baseUrl: base || undefined,
    apiKey: runtimeKeyForProvider(input.runtimeKeys, input.providerId),
  })
  if (res.ok) return

  const detail = res.detail ?? res.kind ?? "ProbeFailed"
  if (res.kind === "cors" || res.kind === "unknown") throw new Error(typeof detail === "string" ? detail : "NetworkError")
  if (res.kind === "missing_key") throw new Error("MissingApiKey")
  throw new Error(typeof detail === "string" ? detail : "ProbeFailed")
}

export const ModelsPanel = memo(function ModelsPanel() {
  const t = useT()
  const lang = useAgentStore((s) => s.settings.lang)
  const active = useAgentStore((s) => s.providers.active)
  const setActiveProvider = useAgentStore((s) => s.actions.setActiveProvider)
  const resetProviderDefaults = useAgentStore((s) => s.actions.resetProviderDefaults)
  const probes = useAgentStore((s) => s.probes)
  const runtimeKeys = useAgentStore((s) => s.runtimeKeys)
  const probeRuntimeKeys = runtimeKeys ?? undefined
  const connectivity = useAgentStore((s) => s.connectivity)
  const setConnectivity = useAgentStore((s) => s.actions.setConnectivity)
  const metrics = useAgentStore((s) => s.inference.last)
  const live = useAgentStore((s) => s.inference.streaming)
  const openCorsHelp = useAgentStore((s) => s.actions.openCorsHelp)

  const [draftProviderId, setDraftProviderId] = useState<ProviderId>(active.providerId)
  const [probeBusy, setProbeBusy] = useState(false)
  const [probeMsg, setProbeMsg] = useState<string | null>(null)
  const [probeFlashFor, setProbeFlashFor] = useState<ProviderId | null>(null)
  const [testingKey, setTestingKey] = useState<string | null>(null)

  useEffect(() => {
    setDraftProviderId(active.providerId)
  }, [active.providerId])

  const applyDefaults = useCallback((id: ProviderId) => {
    // Keep button behavior: force reset in store.
    resetProviderDefaults(id)
    // If user chooses a provider that doesn't match the current active, also update selection state.
    setDraftProviderId(id)
  }, [resetProviderDefaults])

  const onPick = useCallback(
    (id: ProviderId) => {
      setDraftProviderId(id)
      resetProviderDefaults(id)
    },
    [resetProviderDefaults]
  )

  const onSave = useCallback(() => {
    // Store is the source of truth now; just normalize trimming.
    setActiveProvider({
      providerId: active.providerId,
      model: (active.model ?? "").trim(),
      baseUrl: (active.baseUrl ?? "").trim() ? (active.baseUrl ?? "").trim() : undefined,
    })
  }, [active.baseUrl, active.model, active.providerId, setActiveProvider])

  const onProbe = useCallback(async () => {
    setProbeMsg(null)
    setProbeBusy(true)
    try {
      await probeDraftProvider({
        providerId: active.providerId,
        model: active.model,
        baseUrl: active.baseUrl ?? "",
        runtimeKeys: probeRuntimeKeys ?? null,
      })
      setProbeFlashFor(active.providerId)
      window.setTimeout(() => setProbeFlashFor(null), 1400)
      setProbeMsg(t("models.probeOkHint"))
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ProbeFailed"
      setProbeMsg(msg)
      if (isLikelyCorsBlocked(e)) {
        openCorsHelp({
          providerId: active.providerId,
          baseUrl: (active.baseUrl ?? "").trim() ? (active.baseUrl ?? "").trim() : undefined,
          detail: msg,
        })
      }
    } finally {
      setProbeBusy(false)
    }
  }, [active.baseUrl, active.model, active.providerId, openCorsHelp, probeRuntimeKeys, t])

  const keyHint = useMemo(() => {
    const id = active.providerId
    if (id === "openai") return probeRuntimeKeys?.openai ? t("models.keyHint.openai.ok") : t("models.keyHint.openai.missing")
    if (id === "deepseek_openai_compat")
      return probeRuntimeKeys?.deepseek ? t("models.keyHint.deepseek.ok") : t("models.keyHint.deepseek.missing")
    if (id === "anthropic")
      return probeRuntimeKeys?.anthropic ? t("models.keyHint.anthropic.ok") : t("models.keyHint.anthropic.missing")
    if (id === "google")
      return probeRuntimeKeys?.google
        ? t("models.keyHint.google.ok")
        : t("models.keyHint.google.missing")
    if (id === "ollama") return t("models.keyHint.ollama")
    return t("models.keyHint.pick")
  }, [active.providerId, probeRuntimeKeys?.anthropic, probeRuntimeKeys?.deepseek, probeRuntimeKeys?.google, probeRuntimeKeys?.openai, t])

  const ollamaProbe = probes.ollama

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-wide">{t("models.title")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {t("models.desc")}
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-xs text-muted-foreground">
          <Gauge className="h-4 w-4" />
          {t("models.metricsHint")}
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_420px]">
        <div className="rounded-xl border border-border/60 bg-card/30 p-4">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("models.activeProvider")}</div>
          <div className="mt-3 grid gap-2">
            {OPTIONS.map((opt) => {
              const Icon = opt.icon
              const selected = opt.id === draftProviderId
              const cfg = selected ? { model: active.model, baseUrl: active.baseUrl ?? "" } : defaultConfigForProvider(opt.id)
              const key = connKey(opt.id, cfg.baseUrl, cfg.model)
              const state = connectivity[key]
              const busy = testingKey === key
              return (
                <div
                  key={opt.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPick(opt.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onPick(opt.id)
                    }
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-start justify-between gap-3 rounded-sm border px-3 py-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    selected
                      ? "border-sidebar-primary/50 bg-sidebar-primary/10 shadow-[inset_0_0_0_1px_oklch(0.488_0.243_264.376/0.35)]"
                      : "border-border/60 bg-background/25 hover:bg-background/40",
                    probeFlashFor === opt.id && "sk-probe-ok-flash"
                  )}
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border/60 bg-background/40">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{t(opt.titleKey)}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{t(opt.subtitleKey)}</div>
                    </div>
                  </div>
                  <div className="shrink-0 space-y-2 text-right">
                    <div className="text-[11px] text-muted-foreground">{selected ? t("models.selected") : ""}</div>
                    <div className="mt-2 rounded-lg border border-border/60 bg-background/25 p-3 text-left">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[10px] font-semibold tracking-wider text-muted-foreground">{t("conn.bar.title")}</div>
                        <span
                          className={cn(
                            "inline-flex h-2.5 w-2.5 rounded-full",
                            state?.health === "online"
                              ? "bg-emerald-400/90 shadow-[0_0_10px_oklch(0.78_0.2_145/0.55)]"
                              : state?.health === "offline"
                                ? "bg-rose-500/90 shadow-[0_0_10px_oklch(0.65_0.22_25/0.45)]"
                                : "bg-muted-foreground/60"
                          )}
                          aria-hidden
                        />
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[10px] text-muted-foreground">
                        <span>{t("conn.bar.last")}</span>
                        <span className="truncate text-foreground/85">
                          {state?.lastCheckedAt ? formatTs(state.lastCheckedAt, lang) : t("conn.bar.never")}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[10px] text-muted-foreground">
                        <span>{state?.health === "online" ? t("conn.online") : state?.health === "offline" ? t("conn.offline") : "—"}</span>
                        <span className="truncate text-foreground/85">
                          {state?.health === "online"
                            ? `${state.latencyMs ?? "—"}ms`
                            : state?.health === "offline"
                              ? typeof state.errorCode === "number"
                                ? `${state.errorCode}`
                                : connErrorText(t, typeof state.errorCode === "string" ? state.errorCode : undefined)
                              : "—"}
                        </span>
                      </div>

                      <div className="mt-2 flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-2 rounded-sm border-border/60 bg-background/30 font-mono text-[11px]"
                          onClick={async (e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setTestingKey(key)
                            try {
                              const res = await validateProvider(opt.id, cfg.model, {
                                baseUrl: cfg.baseUrl.trim() ? cfg.baseUrl : undefined,
                                apiKey: runtimeKeyForProvider(probeRuntimeKeys ?? null, opt.id),
                              })

                              if (res.ok) {
                                setConnectivity(key, { health: "online", latencyMs: res.latencyMs, errorCode: undefined })
                              } else {
                                const code =
                                  res.kind === "missing_key"
                                    ? "MissingApiKey"
                                    : res.kind === "unauthorized"
                                      ? "InvalidApiKey"
                                      : res.kind === "model_not_found"
                                        ? "ModelMismatch"
                                        : res.kind === "cors"
                                          ? "NetworkError"
                                          : res.kind === "http_error"
                                            ? "HttpError"
                                            : "UnknownError"
                                setConnectivity(key, { health: "offline", latencyMs: null, errorCode: res.status ?? code })
                                if (res.kind === "cors" || isLikelyCorsBlocked(new Error(res.detail ?? code))) {
                                  openCorsHelp({
                                    providerId: opt.id,
                                    baseUrl: cfg.baseUrl.trim() ? cfg.baseUrl.trim() : undefined,
                                    detail: res.detail ?? code,
                                  })
                                }
                              }
                            } finally {
                              setTestingKey(null)
                            }
                          }}
                          disabled={busy}
                        >
                          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                          {t("conn.bar.btn")}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("models.endpoint")}</div>
            <div className="mt-3 grid gap-2">
              <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                <div className="text-xs text-muted-foreground">{t("models.model")}</div>
                <input
                  value={active.model}
                  onChange={(e) => setActiveProvider({ model: e.target.value })}
                  className="h-10 w-full rounded-lg border border-border/60 bg-background/30 px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </div>
              <div className="grid grid-cols-[90px_1fr] items-center gap-2">
                <div className="text-xs text-muted-foreground">{t("models.base")}</div>
                <input
                  value={active.baseUrl ?? ""}
                  onChange={(e) => setActiveProvider({ baseUrl: e.target.value })}
                  placeholder={t("models.base.placeholder")}
                  className="h-10 w-full rounded-lg border border-border/60 bg-background/30 px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button onClick={onSave} className="gap-2">
                {t("models.saveCurrent")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2 border-border/60 bg-background/30"
                onClick={() => applyDefaults(draftProviderId)}
              >
                {t("models.restoreDefault")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2 border-border/60 bg-background/30"
                onClick={onProbe}
                disabled={probeBusy}
              >
                {probeBusy ? t("models.probing") : t("models.probe")}
              </Button>
            </div>

            {probeMsg ? (
              <div className="mt-3 rounded-lg border border-border/60 bg-background/25 p-3 text-xs text-muted-foreground">
                {probeMsg}
              </div>
            ) : null}

            <div className="mt-3 flex items-start gap-2 rounded-lg border border-border/60 bg-background/25 p-3 text-xs text-muted-foreground">
              <KeyRound className="mt-0.5 h-4 w-4" />
              <div>{keyHint}</div>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("models.monitor")}</div>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/25 px-3 py-2">
                <div className="text-xs text-muted-foreground">{t("models.ollamaProbe")}</div>
                <div className="text-xs">
                  <span className="mr-2 text-muted-foreground">{ollamaProbe.latencyMs == null ? "—" : `${ollamaProbe.latencyMs}ms`}</span>
                  <span className="rounded-md border border-border/60 bg-muted/20 px-2 py-0.5 text-[11px]">
                    {ollamaProbe.health}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/25 px-3 py-2">
                <div className="text-xs text-muted-foreground">{t("models.liveInference")}</div>
                <div className="mt-2 grid gap-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("models.state")}</span>
                    <span className="truncate">{live?.active ? t("models.state.streaming") : t("models.state.idle")}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("chat.ttft")}</span>
                    <span>{live?.active ? (live.ttftMs == null ? "—" : `${live.ttftMs}ms`) : "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("models.total")}</span>
                    <span>{live?.active ? `${live.totalMs}ms` : "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("models.chars")}</span>
                    <span>{live?.active ? `${live.chars}` : "—"}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-background/25 px-3 py-2">
                <div className="text-xs text-muted-foreground">{t("models.lastInference")}</div>
                <div className="mt-2 grid gap-1 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("models.provider")}</span>
                    <span className="truncate">{metrics?.providerId ? providerName(t, metrics.providerId) : "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("chat.ttft")}</span>
                    <span>{metrics?.ttftMs == null ? "—" : `${metrics.ttftMs}ms`}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("models.total")}</span>
                    <span>{metrics?.totalMs == null ? "—" : `${metrics.totalMs}ms`}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{t("models.chars")}</span>
                    <span>{metrics?.chars == null ? "—" : `${metrics.chars}`}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
