"use client"

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { BookOpen, Download, Flame, Gauge, Import, LayoutGrid, Moon, Settings, ShieldAlert, SlidersHorizontal, Sun, Trash2, Workflow } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ActionTabBar } from "@/components/action-tab-bar"
import { SetupGuide } from "@/components/setup-guide"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { decryptString, encryptString, type StoredCipherV1 } from "@/lib/crypto"
import {
  appendMessage,
  createConversation,
  fetchConversation,
  fetchConversations,
  patchConversation,
} from "@/lib/conversation-api"
import { buildConversationBackupPayload, parseConversationBackupPayload } from "@/lib/conversation-backup"
import { chatMessageToCreateBody, prismaMessageToChat } from "@/lib/db-types"
import { useAgentStore, type AgentSettings, type ProviderConfig } from "@/store/useAgentStore"

type ExportPayloadV1 = {
  v: 1
  kind: "sk-config"
  cipher: StoredCipherV1
}

type ConversationBackupFileV1 = {
  v: 1
  kind: "sk-conversations"
  cipher: StoredCipherV1
}

type SettingsTab = "general" | "inference" | "behavior" | "dataSecurity" | "helpGuide"

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const SettingsPanel = memo(function SettingsPanel() {
  const t = useT()
  const settings = useAgentStore((s) => s.settings)
  const providers = useAgentStore((s) => s.providers)
  const patchInference = useAgentStore((s) => s.actions.patchInferenceSettings)
  const patchBehavior = useAgentStore((s) => s.actions.patchBehaviorSettings)
  const patchUi = useAgentStore((s) => s.actions.patchUiSettings)
  const setTheme = useAgentStore((s) => s.actions.setTheme)
  const setLang = useAgentStore((s) => s.actions.setLang)
  const clearAllLocalData = useAgentStore((s) => s.actions.clearAllLocalData)
  const clearSessionStorage = useAgentStore((s) => s.actions.clearSessionStorage)
  const importConfig = useAgentStore((s) => s.actions.importConfig)
  const pushToast = useAgentStore((s) => s.actions.pushToast)

  const [tab, setTab] = useState<SettingsTab>("general")

  const notifySaved = useCallback(() => {
    pushToast({ messageKey: "settings.toast.saved", variant: "success", ttlMs: 2400 })
  }, [pushToast])

  // Security modal
  const [dangerOpen, setDangerOpen] = useState(false)
  const [dangerText, setDangerText] = useState("")

  // Export/import (encrypted)
  const [exportPass, setExportPass] = useState("")
  const [importPass, setImportPass] = useState("")
  const [busy, setBusy] = useState<"idle" | "export" | "import" | "conv-export" | "conv-import">("idle")
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [convBackupPass, setConvBackupPass] = useState("")
  const convFileRef = useRef<HTMLInputElement | null>(null)
  const fetchConversationsList = useAgentStore((s) => s.actions.fetchConversationsList)

  const tabs = useMemo(
    () =>
      [
        { id: "general" as const, icon: LayoutGrid, label: t("settings.tab.general") },
        { id: "inference" as const, icon: Gauge, label: t("settings.tab.inference") },
        { id: "behavior" as const, icon: Workflow, label: t("settings.tab.behavior") },
        { id: "dataSecurity" as const, icon: ShieldAlert, label: t("settings.tab.dataSecurity") },
        { id: "helpGuide" as const, icon: BookOpen, label: t("settings.tab.helpGuide") },
      ] as const,
    [t]
  )

  const onExport = useCallback(async () => {
    if (busy !== "idle") return
    const pass = exportPass.trim()
    if (!pass) {
      pushToast({ messageKey: "settings.export.missingPass", variant: "error", ttlMs: 4200 })
      return
    }
    setBusy("export")
    try {
      const payload = {
        settings,
        providers,
        exportedAt: Date.now(),
      }
      const cipher = await encryptString(pass, JSON.stringify(payload))
      const out: ExportPayloadV1 = { v: 1, kind: "sk-config", cipher }
      const blob = new Blob([JSON.stringify(out)], { type: "application/json;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "scholarkernel-agent.config.json"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      pushToast({ messageKey: "settings.export.done", variant: "success" })
    } catch (e) {
      pushToast({ messageKey: "settings.export.failed", detail: e instanceof Error ? e.message : "ExportFailed", variant: "error", ttlMs: 5200 })
    } finally {
      setBusy("idle")
    }
  }, [busy, exportPass, providers, pushToast, settings])

  const onExportConversations = useCallback(async () => {
    if (busy !== "idle") return
    const pass = convBackupPass.trim() || exportPass.trim()
    if (!pass) {
      pushToast({ messageKey: "settings.export.missingPass", variant: "error", ttlMs: 4200 })
      return
    }
    setBusy("conv-export")
    try {
      const list = await fetchConversations()
      const entries = await Promise.all(
        list.map(async (c) => {
          const detail = await fetchConversation(c.id)
          return {
            title: c.title,
            isPinned: c.isPinned,
            messages: detail.messages.map((m) => prismaMessageToChat(m)),
          }
        })
      )
      const payload = buildConversationBackupPayload(entries)
      const cipher = await encryptString(pass, JSON.stringify(payload))
      const out: ConversationBackupFileV1 = { v: 1, kind: "sk-conversations", cipher }
      const blob = new Blob([JSON.stringify(out)], { type: "application/json;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "scholarkernel-conversations.backup.json"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      pushToast({ messageKey: "settings.conversations.backup.done", variant: "success" })
    } catch (e) {
      pushToast({
        messageKey: "settings.conversations.backup.failed",
        detail: e instanceof Error ? e.message : "BackupFailed",
        variant: "error",
        ttlMs: 5200,
      })
    } finally {
      setBusy("idle")
    }
  }, [busy, convBackupPass, exportPass, pushToast])

  const onImportConversations = useCallback(
    async (file: File | null) => {
      if (!file || busy !== "idle") return
      const pass = convBackupPass.trim() || importPass.trim()
      if (!pass) {
        pushToast({ messageKey: "settings.import.missingPass", variant: "error", ttlMs: 4200 })
        return
      }
      setBusy("conv-import")
      try {
        const raw = safeParseJson(await file.text())
        if (!isObj(raw) || raw.v !== 1 || raw.kind !== "sk-conversations") {
          throw new Error("InvalidBackupFile")
        }
        const cipher = raw.cipher as StoredCipherV1
        const plaintext = await decryptString(pass, cipher)
        const payload = parseConversationBackupPayload(safeParseJson(plaintext))
        if (!payload) throw new Error("InvalidBackupPayload")
        for (const entry of payload.conversations) {
          const created = await createConversation()
          if (entry.title !== "新对话" || entry.isPinned) {
            await patchConversation(created.id, { title: entry.title, isPinned: entry.isPinned })
          }
          for (const msg of entry.messages) {
            await appendMessage(created.id, chatMessageToCreateBody(msg))
          }
        }
        await fetchConversationsList()
        pushToast({ messageKey: "settings.conversations.backup.restored", variant: "success" })
      } catch (e) {
        pushToast({
          messageKey: "settings.conversations.backup.failed",
          detail: e instanceof Error ? e.message : "RestoreFailed",
          variant: "error",
          ttlMs: 5200,
        })
      } finally {
        setBusy("idle")
        if (convFileRef.current) convFileRef.current.value = ""
      }
    },
    [busy, convBackupPass, fetchConversationsList, importPass, pushToast]
  )

  const onPickImportFile = useCallback(() => {
    if (busy !== "idle") return
    fileRef.current?.click()
  }, [busy])

  const onImportFile = useCallback(
    async (file: File | null) => {
      if (!file || busy !== "idle") return
      const pass = importPass.trim()
      if (!pass) {
        pushToast({ messageKey: "settings.import.missingPass", variant: "error", ttlMs: 4200 })
        return
      }
      setBusy("import")
      try {
        const raw = await file.text()
        const parsed = safeParseJson(raw)
        if (!isObj(parsed) || parsed.kind !== "sk-config" || parsed.v !== 1 || !isObj(parsed.cipher)) {
          throw new Error("InvalidConfigFile")
        }
        const cipher = parsed.cipher as StoredCipherV1
        const plaintext = await decryptString(pass, cipher)
        const inner = safeParseJson(plaintext)
        if (!isObj(inner)) throw new Error("InvalidConfigPayload")

        const nextSettings = (isObj(inner.settings) ? (inner.settings as Partial<AgentSettings>) : undefined) ?? undefined
        const nextProviders = isObj(inner.providers) ? (inner.providers as { active?: unknown }) : undefined

        importConfig({
          settings: nextSettings,
          providers: nextProviders && nextProviders.active ? { active: nextProviders.active as ProviderConfig } : undefined,
        })

        pushToast({ messageKey: "settings.import.done", variant: "success" })
      } catch (e) {
        pushToast({ messageKey: "settings.import.failed", detail: e instanceof Error ? e.message : "ImportFailed", variant: "error", ttlMs: 5200 })
      } finally {
        setBusy("idle")
        if (fileRef.current) fileRef.current.value = ""
      }
    },
    [busy, importConfig, importPass, pushToast]
  )

  const onConfirmClear = useCallback(() => {
    if (dangerText.trim().toUpperCase() !== "CLEAR") return
    clearAllLocalData()
    setDangerOpen(false)
    setDangerText("")
    pushToast({ messageKey: "settings.security.cleared", variant: "success" })
  }, [clearAllLocalData, dangerText, pushToast])

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-semibold tracking-wide">{t("settings.title")}</div>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{t("settings.subtitle")}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* Tabs / vertical nav */}
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-2 font-mono dark:border-neutral-800 dark:bg-neutral-900">
          <div className="grid gap-2">
            {tabs.map((it) => {
              const Icon = it.icon
              const active = tab === it.id
              return (
                <Button
                  key={it.id}
                  type="button"
                  variant="outline"
                  className={cn(
                    "h-10 w-full justify-start gap-2 rounded-sm border-zinc-200 bg-white/60 font-mono text-[13px] hover:bg-white dark:border-neutral-800 dark:bg-neutral-950/60 dark:hover:bg-neutral-950",
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

        {/* Content */}
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 font-mono dark:border-neutral-800 dark:bg-neutral-900">
          {tab === "general" ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm font-semibold tracking-wide">{t("settings.general.title")}</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.general.appearance")}</div>
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-2">
                      <div className="text-sm">{t("settings.general.theme")}</div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "h-9 gap-2 rounded-sm border-zinc-200 bg-white font-mono text-xs hover:bg-zinc-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900",
                            settings.theme === "light" && "border-sidebar-primary/50 bg-sidebar-primary/10"
                          )}
                          onClick={() => {
                            setTheme("light")
                            notifySaved()
                          }}
                        >
                          <Sun className="h-4 w-4" />
                          {t("settings.general.theme.light")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "h-9 gap-2 rounded-sm border-zinc-200 bg-white font-mono text-xs hover:bg-zinc-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900",
                            settings.theme === "dark" && "border-sidebar-primary/50 bg-sidebar-primary/10"
                          )}
                          onClick={() => {
                            setTheme("dark")
                            notifySaved()
                          }}
                        >
                          <Moon className="h-4 w-4" />
                          {t("settings.general.theme.dark")}
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground">{t("settings.general.theme.hint")}</div>
                    </div>

                    <div className="h-px bg-border/50" />

                    <div className="grid gap-2">
                      <div className="text-sm">{t("settings.general.language")}</div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "h-9 rounded-sm border-zinc-200 bg-white px-3 font-mono text-xs hover:bg-zinc-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900",
                            settings.lang === "zh" && "border-sidebar-primary/50 bg-sidebar-primary/10"
                          )}
                          onClick={() => {
                            setLang("zh")
                            notifySaved()
                          }}
                        >
                          中文
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "h-9 rounded-sm border-zinc-200 bg-white px-3 font-mono text-xs hover:bg-zinc-50 dark:border-neutral-800 dark:bg-neutral-950 dark:hover:bg-neutral-900",
                            settings.lang === "en" && "border-sidebar-primary/50 bg-sidebar-primary/10"
                          )}
                          onClick={() => {
                            setLang("en")
                            notifySaved()
                          }}
                        >
                          English
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground">{t("settings.general.language.hint")}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.ui.title")}</div>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t("settings.ui.compactMode")}</span>
                      <input
                        type="checkbox"
                        checked={!!settings.ui.compactMode}
                        onChange={(e) => patchUi({ compactMode: e.target.checked })}
                        onBlur={notifySaved}
                        className="h-5 w-5 accent-sidebar-primary"
                      />
                    </label>
                    <div className="text-xs text-muted-foreground">{t("settings.ui.compactMode.hint")}</div>

                    <div className="h-px bg-border/50" />

                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t("settings.ui.showThinking")}</span>
                      <input
                        type="checkbox"
                        checked={!!settings.ui.showThinking}
                        onChange={(e) => patchUi({ showThinking: e.target.checked })}
                        onBlur={notifySaved}
                        className="h-5 w-5 accent-sidebar-primary"
                      />
                    </label>
                    <div className="text-xs text-muted-foreground">{t("settings.ui.showThinking.hint")}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "inference" ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm font-semibold tracking-wide">{t("settings.inference.title")}</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.inference.temperatureTau")}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{t("settings.inference.temperatureTau.hint")}</div>
                    </div>
                    <span className="rounded-md border border-border/60 bg-background/20 px-2 py-1 font-mono text-xs">
                      {settings.inference.temperature.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.01}
                    value={settings.inference.temperature}
                    onChange={(e) => patchInference({ temperature: clamp(Number(e.target.value), 0, 1.5) })}
                    onMouseUp={notifySaved}
                    onTouchEnd={notifySaved}
                    className="mt-4 w-full accent-sidebar-primary"
                  />
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.inference.maxTokens")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t("settings.inference.maxTokens.hint")}</div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      value={settings.inference.maxTokens}
                      onChange={(e) => patchInference({ maxTokens: clamp(Number(e.target.value || 1), 1, 8192) })}
                      onBlur={notifySaved}
                      type="number"
                      min={1}
                      max={8192}
                      step={1}
                      className="h-10 w-full rounded-sm border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:border-neutral-800 dark:bg-neutral-900"
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 lg:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.inference.contextLimit")}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{t("settings.inference.contextLimit.hint")}</div>
                    </div>
                    <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-3 grid gap-2 lg:grid-cols-[220px_1fr]">
                    <input
                      value={settings.inference.contextLimit}
                      onChange={(e) => patchInference({ contextLimit: clamp(Number(e.target.value || 0), 0, 240_000) })}
                      onBlur={notifySaved}
                      type="number"
                      min={0}
                      max={240_000}
                      step={1000}
                      className="h-10 rounded-sm border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:border-neutral-800 dark:bg-neutral-900"
                    />
                    <div className="text-xs text-muted-foreground">{t("settings.inference.contextLimit.note")}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "behavior" ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <Workflow className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm font-semibold tracking-wide">{t("settings.behavior.title")}</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.behavior.agent.title")}</div>
                  <div className="mt-3 space-y-3">
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t("settings.behavior.autoSearch")}</span>
                      <input
                        type="checkbox"
                        checked={!!settings.behavior.autoSearch}
                        onChange={(e) => patchBehavior({ autoSearch: e.target.checked })}
                        onBlur={notifySaved}
                        className="h-5 w-5 accent-sidebar-primary"
                      />
                    </label>
                    <div className="text-xs text-muted-foreground">{t("settings.behavior.autoSearch.hint")}</div>

                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t("settings.behavior.localOnly")}</span>
                      <input
                        type="checkbox"
                        checked={!!settings.behavior.localOnly}
                        onChange={(e) => patchBehavior({ localOnly: e.target.checked })}
                        onBlur={notifySaved}
                        className="h-5 w-5 accent-sidebar-primary"
                      />
                    </label>
                    <div className="text-xs text-muted-foreground">{t("settings.behavior.localOnly.hint")}</div>

                    <div className="h-px bg-border/50" />

                    <div className="grid grid-cols-[1fr_180px] items-center gap-3">
                      <div>
                        <div className="text-sm">{t("settings.behavior.planningDepth")}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{t("settings.behavior.planningDepth.hint")}</div>
                      </div>
                      <select
                        value={settings.behavior.planningDepth}
                        onChange={(e) =>
                          patchBehavior({ planningDepth: e.target.value as AgentSettings["behavior"]["planningDepth"] })
                        }
                        onBlur={notifySaved}
                        className="h-10 rounded-sm border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:border-neutral-800 dark:bg-neutral-900"
                      >
                        <option value="conservative">{t("settings.behavior.planningDepth.conservative")}</option>
                        <option value="balanced">{t("settings.behavior.planningDepth.balanced")}</option>
                        <option value="creative">{t("settings.behavior.planningDepth.creative")}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.behavior.resilience.title")}</div>
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-[1fr_120px] items-center gap-3">
                      <div>
                        <div className="text-sm">{t("settings.behavior.maxRetries")}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{t("settings.behavior.maxRetries.hint")}</div>
                      </div>
                      <input
                        value={settings.behavior.maxRetries}
                        onChange={(e) => patchBehavior({ maxRetries: clamp(Number(e.target.value || 0), 0, 6) })}
                        onBlur={notifySaved}
                        type="number"
                        min={0}
                        max={6}
                        step={1}
                        className="h-10 rounded-sm border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/40 dark:border-neutral-800 dark:bg-neutral-900"
                      />
                    </div>

                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm">{t("settings.behavior.persistUi")}</span>
                      <input
                        type="checkbox"
                        checked={!!settings.ui.showThinking}
                        onChange={(e) => patchUi({ showThinking: e.target.checked })}
                        onBlur={notifySaved}
                        className="h-5 w-5 accent-sidebar-primary"
                      />
                    </label>
                    <div className="text-xs text-muted-foreground">{t("settings.behavior.persistUi.hint")}</div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "dataSecurity" ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm font-semibold tracking-wide">{t("settings.dataSecurity.title")}</div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                    <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.session.clear.title")}</div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{t("settings.session.clear.hint")}</div>
                  <div className="mt-3 flex items-center justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2 rounded-sm border-zinc-200 bg-zinc-50 font-mono text-xs hover:bg-zinc-100 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                      onClick={() => {
                        clearSessionStorage()
                        pushToast({ messageKey: "settings.session.clear.done", variant: "success" })
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t("settings.session.clear.btn")}
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 dark:bg-rose-500/10">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Flame className="h-4 w-4 text-rose-200" />
                        <div className="text-sm font-semibold tracking-wide text-rose-50">{t("settings.security.clearAll")}</div>
                      </div>
                      <div className="mt-1 text-xs text-rose-100/80">{t("settings.security.clearAll.hint")}</div>
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      className="gap-2"
                      onClick={() => {
                        setDangerOpen(true)
                        setDangerText("")
                      }}
                    >
                      <ShieldAlert className="h-4 w-4" />
                      {t("settings.security.clearNow")}
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 lg:col-span-2">
                  <div className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-muted-foreground" />
                    <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                      {t("settings.export.title")} / {t("settings.import.title")}
                    </div>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => onImportFile(e.target.files?.[0] ?? null)}
                  />
                  <ActionTabBar
                    className="mt-3"
                    hideGroupTabsWhenSingle={false}
                    defaultGroupId="export"
                    groups={[
                      {
                        id: "export",
                        label: t("settings.export.title"),
                        panel: (
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">{t("settings.export.hint")}</div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={exportPass}
                                onChange={(e) => setExportPass(e.target.value)}
                                type="password"
                                placeholder={t("settings.export.passPlaceholder")}
                                className="h-10 min-w-0 flex-1 rounded-sm border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 dark:border-neutral-800 dark:bg-neutral-900"
                              />
                              <Button onClick={onExport} className="gap-2" disabled={busy !== "idle"}>
                                <Download className="h-4 w-4" />
                                {busy === "export" ? t("settings.export.working") : t("settings.export.btn")}
                              </Button>
                            </div>
                          </div>
                        ),
                      },
                      {
                        id: "import",
                        label: t("settings.import.title"),
                        panel: (
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">{t("settings.import.hint")}</div>
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={importPass}
                                onChange={(e) => setImportPass(e.target.value)}
                                type="password"
                                placeholder={t("settings.import.passPlaceholder")}
                                className="h-10 min-w-0 flex-1 rounded-sm border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 dark:border-neutral-800 dark:bg-neutral-900"
                              />
                              <Button
                                onClick={onPickImportFile}
                                variant="outline"
                                className="gap-2 rounded-sm border-zinc-200 bg-zinc-50 font-mono text-xs hover:bg-zinc-100 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                                disabled={busy !== "idle"}
                              >
                                <Import className="h-4 w-4" />
                                {busy === "import" ? t("settings.import.working") : t("settings.import.btn")}
                              </Button>
                            </div>
                          </div>
                        ),
                      },
                    ]}
                  />
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 lg:col-span-2">
                  <div className="flex items-center gap-2">
                    <Download className="h-4 w-4 text-muted-foreground" />
                    <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                      {t("settings.conversations.backup.title")}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{t("settings.conversations.backup.hint")}</div>
                  <input
                    ref={convFileRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => void onImportConversations(e.target.files?.[0] ?? null)}
                  />
                  <div className="mt-3">
                    <input
                      value={convBackupPass}
                      onChange={(e) => setConvBackupPass(e.target.value)}
                      type="password"
                      placeholder={t("settings.export.passPlaceholder")}
                      className="h-10 w-full rounded-sm border border-zinc-200 bg-zinc-50 px-3 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40 dark:border-neutral-800 dark:bg-neutral-900"
                    />
                    <ActionTabBar
                      className="mt-2"
                      hideGroupTabsWhenSingle={false}
                      defaultGroupId="export"
                      groups={[
                        {
                          id: "export",
                          label: t("settings.conversations.backup.export"),
                          panel: (
                            <Button
                              onClick={() => void onExportConversations()}
                              className="gap-2"
                              disabled={busy !== "idle"}
                            >
                              <Download className="h-4 w-4" />
                              {busy === "conv-export" ? t("settings.export.working") : t("settings.conversations.backup.export")}
                            </Button>
                          ),
                        },
                        {
                          id: "import",
                          label: t("settings.conversations.backup.import"),
                          panel: (
                            <Button
                              onClick={() => convFileRef.current?.click()}
                              variant="outline"
                              className="gap-2 rounded-sm border-zinc-200 bg-zinc-50 font-mono text-xs hover:bg-zinc-100 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                              disabled={busy !== "idle"}
                            >
                              <Import className="h-4 w-4" />
                              {busy === "conv-import" ? t("settings.import.working") : t("settings.conversations.backup.import")}
                            </Button>
                          ),
                        },
                      ]}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 text-xs text-muted-foreground dark:border-neutral-800 dark:bg-neutral-950">
                {t("settings.dataSecurity.note")}
              </div>
            </div>
          ) : null}

          {tab === "helpGuide" ? (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm font-semibold tracking-wide">{t("settings.helpGuide.title")}</div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
                <SetupGuide />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Danger confirmation modal */}
      {dangerOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-[520px] rounded-xl border border-border/60 bg-background/90 p-4 shadow-[0_30px_120px_oklch(0_0_0/0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-rose-300" />
                  <div className="text-sm font-semibold tracking-wide">{t("settings.security.modal.title")}</div>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{t("settings.security.modal.desc")}</div>
              </div>
              <Button
                variant="outline"
                className="border-border/60 bg-background/30"
                onClick={() => {
                  setDangerOpen(false)
                  setDangerText("")
                }}
              >
                {t("settings.security.modal.cancel")}
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-100/90">
              {t("settings.security.modal.warn")}
            </div>

            <div className="mt-4 grid gap-2">
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("settings.security.modal.typeToConfirm")}</div>
              <input
                value={dangerText}
                onChange={(e) => setDangerText(e.target.value)}
                placeholder="CLEAR"
                className="h-10 rounded-sm border border-border/60 bg-background/30 px-3 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                variant="destructive"
                className="gap-2"
                disabled={dangerText.trim().toUpperCase() !== "CLEAR"}
                onClick={onConfirmClear}
              >
                <ShieldAlert className="h-4 w-4" />
                {t("settings.security.modal.confirm")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})
