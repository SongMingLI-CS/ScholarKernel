"use client"

import { memo, useCallback } from "react"
import { Download, FileText, X } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

import { AcademicMarkdown } from "@/components/academic-markdown"
import { Button } from "@/components/ui/button"
import { downloadTextFile, sanitizeExportFilename } from "@/lib/conversation-utils"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

function exportAsWord(title: string, markdown: string) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body><pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:12pt;line-height:1.6">${markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`
  downloadTextFile(sanitizeExportFilename(title).replace(/\.md$/, ".doc"), html, "application/msword;charset=utf-8")
}

export const ScholarCanvas = memo(function ScholarCanvas({ className }: { className?: string }) {
  const t = useT()
  const doc = useAgentStore((s) => s.canvas.activeDocument)
  const closeCanvas = useAgentStore((s) => s.actions.closeCanvas)

  const onExportMd = useCallback(() => {
    if (!doc?.content.trim()) return
    downloadTextFile(sanitizeExportFilename(doc.title), doc.content)
  }, [doc])

  const onExportDoc = useCallback(() => {
    if (!doc?.content.trim()) return
    exportAsWord(doc.title, doc.content)
  }, [doc])

  if (!doc) return null

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-border/60 bg-card/20 shadow-[inset_0_1px_0_oklch(1_0_0/0.04)]",
        className
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-md">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t("chat.canvas.title")}</div>
          <h2 className="truncate font-sans text-base font-semibold text-foreground/95">{doc.title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-sm border-border/60 bg-background/40 font-mono text-[10px]"
            onClick={onExportMd}
            disabled={!doc.content.trim()}
          >
            <Download className="h-3.5 w-3.5" />
            {t("chat.canvas.exportMd")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 rounded-sm border-border/60 bg-background/40 font-mono text-[10px]"
            onClick={onExportDoc}
            disabled={!doc.content.trim()}
          >
            <FileText className="h-3.5 w-3.5" />
            {t("chat.canvas.exportDoc")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 rounded-sm"
            aria-label={t("chat.canvas.close")}
            onClick={closeCanvas}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto sk-scrollbar px-6 py-8 md:px-10">
        {doc.content.trim() ? (
          <AcademicMarkdown
            content={doc.content}
            className="max-w-none [&_.sk-md-root]:text-[15px] [&_.sk-md-root]:leading-8"
            fallbackPrefix={t("chat.replyRenderFailed")}
          />
        ) : (
          <p className="font-mono text-sm text-muted-foreground">{t("chat.canvas.empty")}</p>
        )}
      </div>
    </div>
  )
})

/** Mobile full-screen drawer for Scholar Canvas (< lg). */
export const ScholarCanvasMobileDrawer = memo(function ScholarCanvasMobileDrawer() {
  const canvasOpen = useAgentStore((s) => s.canvas.canvasOpen)
  const activeDocument = useAgentStore((s) => s.canvas.activeDocument)
  const closeCanvas = useAgentStore((s) => s.actions.closeCanvas)

  return (
    <AnimatePresence>
      {canvasOpen && activeDocument ? (
        <>
          <motion.button
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            aria-label="Close canvas overlay"
            onClick={closeCanvas}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="fixed inset-x-0 bottom-0 top-12 z-50 flex flex-col overflow-hidden bg-background lg:hidden"
          >
            <ScholarCanvas className="h-full rounded-none border-0" />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  )
})
