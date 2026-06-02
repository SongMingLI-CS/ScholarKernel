"use client"

import { FileText, Loader2, Zap } from "lucide-react"
import { memo } from "react"

import { Button } from "@/components/ui/button"
import { useT } from "@/lib/locales"
import type { CanvasChatCardPayload } from "@/lib/scholar-canvas"
import { cn } from "@/lib/utils"

export const CanvasChatPlaceholderCard = memo(function CanvasChatPlaceholderCard({
  card,
  onViewInCanvas,
  className,
}: {
  card: CanvasChatCardPayload
  onViewInCanvas?: () => void
  className?: string
}) {
  const t = useT()
  const streaming = card.streaming

  return (
    <div
      className={cn(
        "not-prose relative overflow-hidden rounded-xl border border-gray-700/60 bg-gray-800/40 p-4 shadow-[inset_0_1px_0_oklch(1_0_0/0.05)]",
        streaming && "border-amber-600/40 bg-gray-800/50",
        className
      )}
      data-testid="canvas-chat-placeholder-card"
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-gray-600/50 bg-gray-900/50",
            streaming ? "text-amber-300/90" : "text-gray-200/90"
          )}
        >
          {streaming ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gray-400">
            {streaming ? t("chat.canvasCard.streaming") : t("chat.canvasCard.ready")}
          </p>
          <h3 className="mt-1.5 truncate font-sans text-[15px] font-semibold leading-snug text-gray-100">
            {card.title}
          </h3>
          <p className="mt-1 font-mono text-[11px] text-gray-400">
            {t("chat.canvasCard.chars", { count: card.charCount.toLocaleString() })}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="sk-canvas-artifact-cta mt-3 h-8 gap-1.5 rounded-lg border-gray-600/70 bg-gray-900/40 font-sans text-[12px] text-gray-100 hover:border-emerald-500/50 hover:bg-emerald-950/40 hover:text-emerald-50"
            onClick={onViewInCanvas}
          >
            <Zap className="h-3.5 w-3.5 shrink-0 text-amber-300/90" aria-hidden />
            {t("chat.canvasCard.viewInPanel")}
          </Button>
        </div>
      </div>
    </div>
  )
})
