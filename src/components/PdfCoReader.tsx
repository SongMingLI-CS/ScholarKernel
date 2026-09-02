"use client"

import { memo, useEffect, useMemo, useRef, useState } from "react"
import { FileText, FileWarning } from "lucide-react"

import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

export const PdfCoReader = memo(function PdfCoReader({ className }: { className?: string }) {
  const t = useT()
  const pdfUrl = useAgentStore((s) => s.pdfCoReader.sessionPdfUrl)
  const pdfName = useAgentStore((s) => s.pdfCoReader.sessionPdfName)
  const targetPage = useAgentStore((s) => s.pdfCoReader.targetPage)
  const scrollNonce = useAgentStore((s) => s.pdfCoReader.scrollNonce)
  const containerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [pulsing, setPulsing] = useState(false)

  const iframeSrc = useMemo(() => {
    if (!pdfUrl) return null
    const base = pdfUrl.split("#")[0]!
    const page = targetPage && targetPage > 0 ? targetPage : 1
    return `${base}#page=${page}`
  }, [pdfUrl, targetPage])

  useEffect(() => {
    if (!targetPage || !scrollNonce) return
    setPulsing(true)
    containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    const timer = window.setTimeout(() => setPulsing(false), 2000)
    return () => window.clearTimeout(timer)
  }, [targetPage, scrollNonce])

  if (!pdfUrl) {
    return (
      <div
        className={cn(
          "flex min-h-[280px] flex-1 flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-border/50 bg-muted/10 px-6 py-12 text-center",
          className
        )}
      >
        <FileWarning className="h-10 w-10 text-muted-foreground/60" />
        <p className="max-w-sm font-mono text-[12px] leading-relaxed text-muted-foreground">{t("chat.coReader.noPdf")}</p>
      </div>
    )
  }

  return (
    <div ref={containerRef} className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div className="mb-2 flex shrink-0 items-center gap-2 border-b border-border/40 pb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <FileText className="h-3.5 w-3.5 text-amber-400/80" />
        <span className="truncate">{pdfName ?? t("chat.coReader.sourcePdf")}</span>
        {targetPage ? (
          <span className="ml-auto text-amber-400/90">
            {t("chat.coReader.page", { page: String(targetPage) })}
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden rounded-sm border border-border/50 bg-zinc-950/40 transition-shadow",
          pulsing && "animate-pulse border-2 border-emerald-500 shadow-[0_0_24px_oklch(0.72_0.19_155/0.35)]"
        )}
      >
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            key={iframeSrc}
            title={pdfName ?? "PDF Co-Reader"}
            src={iframeSrc}
            className="h-full min-h-[480px] w-full border-0 bg-white/5"
          />
        ) : null}
      </div>
    </div>
  )
})
