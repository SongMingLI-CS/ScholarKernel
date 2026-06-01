"use client"

import { memo, useEffect, useMemo } from "react"
import { ShieldAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

export const CorsHelpDialog = memo(function CorsHelpDialog() {
  const t = useT()
  const corsHelp = useAgentStore((s) => s.ui.corsHelp)
  const close = useAgentStore((s) => s.actions.closeCorsHelp)

  const open = corsHelp.open

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [close, open])

  const title = useMemo(() => {
    if (!corsHelp.open) return ""
    return corsHelp.title
  }, [corsHelp])

  if (!corsHelp.open) return null

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        aria-label="close"
        onClick={close}
      />

      <div className="relative mx-auto flex min-h-dvh max-w-[720px] items-center px-4 py-10">
        <div
          className={cn(
            "w-full overflow-hidden rounded-2xl border border-border/60 bg-background/85 shadow-[0_0_0_1px_oklch(0.488_0.243_264.376/0.18),0_30px_120px_oklch(0_0_0/0.55)]"
          )}
          role="dialog"
          aria-modal="true"
          aria-labelledby="sk-cors-title"
        >
          <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-rose-500/25 bg-rose-500/10">
                <ShieldAlert className="h-5 w-5 text-rose-200" />
              </span>
              <div className="min-w-0">
                <div id="sk-cors-title" className="text-sm font-semibold tracking-wide">
                  {title}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("cors.provider")}：<span className="text-foreground/90">{corsHelp.providerId}</span>
                  {corsHelp.baseUrl ? (
                    <>
                      {" "}
                      · {t("cors.base")}：<span className="break-all text-foreground/90">{corsHelp.baseUrl}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <Button variant="outline" size="icon-sm" className="border-border/60 bg-background/30" onClick={close}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-4 px-5 py-4">
            <div className="rounded-xl border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
              <div className="font-semibold text-foreground/90">{t("cors.summaryTitle")}</div>
              <div className="mt-2 break-words font-mono text-[11px] text-foreground/80">{corsHelp.detail}</div>
            </div>

            <div>
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">{t("cors.recommendedPath")}</div>
              <ol className="mt-2 space-y-2 text-sm leading-relaxed text-foreground/90">
                {corsHelp.hints.map((h, idx) => (
                  <li key={idx} className="flex gap-2">
                    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/30 text-[11px] text-muted-foreground">
                      {idx + 1}
                    </span>
                    <span className="text-sm">{h}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-4">
              <Button variant="outline" className="border-border/60 bg-background/30" onClick={close}>
                {t("cors.close")}
              </Button>
              <Button
                onClick={() => {
                  useAgentStore.getState().actions.setActivePanel("models")
                  close()
                }}
              >
                {t("cors.gotoModels")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
