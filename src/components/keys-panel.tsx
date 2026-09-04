
"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ActionTabBar } from "@/components/action-tab-bar"
import { clearEncryptedKeysFromStorage, hasEncryptedKeysInStorage } from "@/lib/crypto"
import { patchSettings } from "@/lib/conversation-api"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/locales"
import {
  EMPTY_RUNTIME_KEYS,
  isUsableApiKey,
  RUNTIME_KEY_FIELDS,
  useAgentStore,
  type RuntimeKeyField,
  type RuntimeKeys,
} from "@/store/useAgentStore"

type KeyBundle = RuntimeKeys
const EMPTY_KEY_BUNDLE: KeyBundle = { ...EMPTY_RUNTIME_KEYS }

export const KeysPanel = memo(function KeysPanel() {
  const t = useT()
  const keyStatus = useAgentStore((s) => s.keys)
  const setKeyStatus = useAgentStore((s) => s.actions.setKeyStatus)
  const setRuntimeKeys = useAgentStore((s) => s.actions.setRuntimeKeys)
  const pushToast = useAgentStore((s) => s.actions.pushToast)
  const configured = useAgentStore((s) => s.keys.configured)

  const [bundle, setBundle] = useState<KeyBundle>(() => ({ ...EMPTY_KEY_BUNDLE }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showBundle, setShowBundle] = useState<Record<string, boolean>>({})

  useEffect(() => {
    setKeyStatus((prev) => ({
      ...prev,
      hasEncryptedKeys: hasEncryptedKeysInStorage(),
    }))
  }, [setKeyStatus])

  const canApply = useMemo(
    () => Object.values(bundle).some((v) => isUsableApiKey(v) || (v ?? "").trim().length > 0),
    [bundle]
  )

  const onApplyKeys = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const patch: Partial<RuntimeKeys> = {}
      for (const [k, v] of Object.entries(bundle)) {
        const s = typeof v === "string" ? v.trim() : ""
        if (isUsableApiKey(s)) patch[k as RuntimeKeyField] = s
      }
      if (Object.keys(patch).length === 0) {
        setError("NoKeys")
        return
      }
      const saved = await patchSettings({ runtimeKeys: patch })
      setKeyStatus((prev) => ({
        ...prev,
        unlocked: Object.values(saved.runtimeKeyStatus).some(Boolean),
        configured: saved.runtimeKeyStatus,
      }))
      setBundle({ ...EMPTY_KEY_BUNDLE })
      pushToast({ messageKey: "keys.toast.saved", variant: "success", ttlMs: 2600 })
    } catch (e) {
      setError(e instanceof Error ? e.message : "ApplyFailed")
    } finally {
      setBusy(false)
    }
  }, [bundle, pushToast, setKeyStatus])

  const onClearSessionKeys = useCallback(() => {
    setError(null)
    setRuntimeKeys(null)
    setKeyStatus((prev) => ({ ...prev, unlocked: false }))
    pushToast({ messageKey: "keys.toast.cleared", variant: "success", ttlMs: 2600 })
  }, [pushToast, setKeyStatus, setRuntimeKeys])

  const onClearLegacyEncrypted = useCallback(() => {
    setError(null)
    clearEncryptedKeysFromStorage()
    setKeyStatus((prev) => ({ ...prev, hasEncryptedKeys: false }))
  }, [setKeyStatus])

  const configuredCount = useMemo(
    () => RUNTIME_KEY_FIELDS.filter((f) => configured[f]).length,
    [configured]
  )

  const badge = useMemo(() => {
    if (configuredCount > 0) {
      return { text: t("keys.badge.cloudSynced"), cls: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" }
    }
    if (keyStatus.hasEncryptedKeys) {
      return { text: t("keys.badge.encrypted"), cls: "border-sidebar-primary/30 bg-sidebar-primary/10 text-sidebar-foreground" }
    }
    return { text: t("keys.badge.unsaved"), cls: "border-border/60 bg-muted/20 text-muted-foreground" }
  }, [configuredCount, keyStatus.hasEncryptedKeys, t])

  const sessionKeyGroups = useMemo(
    () => [
      {
        id: "session",
        label: t("keys.sessionKeys"),
        items: [
          {
            id: "apply",
            label: t("keys.applyToSession"),
            onClick: onApplyKeys,
            disabled: !canApply || busy,
          },
          {
            id: "clear",
            label: t("keys.clearSession"),
            onClick: onClearSessionKeys,
            disabled: busy || configuredCount === 0,
          },
          ...(keyStatus.hasEncryptedKeys
            ? [
                {
                  id: "legacy",
                  label: t("keys.clearLegacyLocal"),
                  icon: <Trash2 className="h-4 w-4" />,
                  onClick: onClearLegacyEncrypted,
                  disabled: busy,
                },
              ]
            : []),
        ],
      },
    ],
    [
      busy,
      canApply,
      keyStatus.hasEncryptedKeys,
      onApplyKeys,
      onClearLegacyEncrypted,
      onClearSessionKeys,
      configuredCount,
      t,
    ]
  )

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-semibold tracking-wide">{t("keys.guard")}</div>
            <span className={cn("rounded-md border px-2 py-0.5 text-[11px] font-semibold", badge.cls)}>
              {badge.text}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{t("keys.cloudEncryptedDesc")}</div>
          <details className="mt-3 rounded-lg border border-border/50 bg-background/20 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold tracking-wide text-muted-foreground">
              {t("keys.dataFlow.title")}
            </summary>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{t("keys.dataFlow.body")}</p>
          </details>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200/90">
          <ShieldCheck className="h-4 w-4" />
          {t("keys.cloudEncrypted")}
        </span>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card/30 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            {t("keys.sessionKeys")}
          </div>
          <div className="mt-3">
            <ActionTabBar groups={sessionKeyGroups} size="xs" />
          </div>
          {error ? (
            <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border/60 bg-card/30 p-4">
          <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("keys.keyBundle")}</div>
          <div className="mt-2 grid gap-2">
            {(["openai", "anthropic", "google", "deepseek", "tavily", "serper"] as const).map((k) => (
              <div key={k} className="grid grid-cols-[120px_1fr] items-center gap-2">
                <div className="font-mono text-xs text-muted-foreground">{k.toUpperCase()}</div>
                <div className="flex gap-2">
                  <input
                    value={(bundle[k] ?? "") as string}
                    onChange={(e) => setBundle((prev) => ({ ...prev, [k]: e.target.value }))}
                    type={showBundle[k] ? "text" : "password"}
                    placeholder={configured[k] ? t("keys.key.placeholder.unlocked") : t("keys.key.placeholder.locked")}
                    className="h-10 min-w-0 flex-1 rounded-sm border border-border/60 bg-background/30 px-3 font-mono text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 shrink-0 rounded-sm border-border/60 bg-background/30 px-2"
                    onClick={() => setShowBundle((prev) => ({ ...prev, [k]: !prev[k] }))}
                    aria-label={`${showBundle[k] ? t("keys.key.hidePrefix") : t("keys.key.showPrefix")} ${k}`}
                  >
                    {showBundle[k] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-xs text-muted-foreground">
            {configuredCount > 0 ? (
              <div className="space-y-1">
                <div className="font-semibold text-emerald-200/90">{t("keys.cloudStatusTitle")}</div>
                <div className="text-[11px] leading-relaxed">
                  {t("keys.cloudStatusConfigured").replace("{count}", String(configuredCount))}
                </div>
                <div className="grid gap-1 font-mono text-[11px]">
                  {RUNTIME_KEY_FIELDS.map((k) => (
                    <div key={k} className="flex items-center justify-between gap-2">
                      <span>{k}</span>
                      <span className={configured[k] ? "text-emerald-300" : "text-muted-foreground"}>
                        {configured[k] ? t("keys.cloudStatusPresent") : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>{t("keys.cloudStatusEmpty")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
