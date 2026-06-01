"use client"

import { memo, useEffect, useMemo } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { CheckCircle2, Info, TriangleAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useT, type LocaleKey } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

export const ToastHost = memo(function ToastHost() {
  const t = useT()
  const toast = useAgentStore((s) => s.ui.toast)
  const close = useAgentStore((s) => s.actions.closeToast)

  const open = toast.open

  useEffect(() => {
    if (!open || !toast.open) return
    const timer = window.setTimeout(() => close(), toast.ttlMs)
    return () => window.clearTimeout(timer)
  }, [close, open, toast])

  const content = useMemo(() => {
    if (!toast.open) return ""
    const base = t(toast.messageKey as LocaleKey)
    return toast.detail ? `${base} ${toast.detail}` : base
  }, [t, toast])

  const Icon = toast.open
    ? toast.variant === "success"
      ? CheckCircle2
      : toast.variant === "error"
        ? TriangleAlert
        : Info
    : Info

  const frameClass =
    toast.open && toast.variant === "success"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-50"
      : toast.open && toast.variant === "error"
        ? "border-rose-500/25 bg-rose-500/10 text-rose-50"
        : "border-border/60 bg-background/80 text-foreground"

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-center px-4">
      <AnimatePresence>
        {toast.open ? (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "pointer-events-auto flex w-full max-w-[720px] items-start justify-between gap-3 rounded-xl border px-4 py-3 shadow-[0_20px_80px_oklch(0_0_0/0.35)] backdrop-blur",
              frameClass
            )}
            role="status"
            aria-live="polite"
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/40 bg-background/20">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="whitespace-pre-wrap text-sm leading-snug">{content}</div>
              </div>
            </div>
            <Button
              variant="outline"
              size="icon-sm"
              className="border-border/50 bg-background/20"
              onClick={close}
              aria-label="close"
            >
              <X className="h-4 w-4" />
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
})

