"use client"

import { memo, useCallback, useMemo, useState } from "react"
import { Download, FileText, X } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

import { CanvasEditor } from "@/components/canvas-editor"
import { ActionTabBar } from "@/components/action-tab-bar"
import { WelcomeEmptyState } from "@/components/welcome-empty-state"
import { Button } from "@/components/ui/button"
import { downloadMarkdownAsDocx } from "@/lib/export-utils"
import { downloadTextFile, sanitizeExportFilename } from "@/lib/conversation-utils"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

export const ScholarCanvas = memo(function ScholarCanvas({
  className,
  highlightPulse = false,
}: {
  className?: string
  highlightPulse?: boolean
}) {
  const t = useT()
  const doc = useAgentStore((s) => s.canvas.activeDocument)
  const closeCanvas = useAgentStore((s) => s.actions.closeCanvas)
  const updateCanvasContent = useAgentStore((s) => s.actions.updateCanvasContent)
  const [exporting, setExporting] = useState(false)

  const onExportMd = useCallback(() => {
    if (!doc?.content.trim()) return
    downloadTextFile(sanitizeExportFilename(doc.title), doc.content)
  }, [doc])

  const onExportDoc = useCallback(async () => {
    if (!doc?.content.trim()) return
    setExporting(true)
    try {
      const base = sanitizeExportFilename(doc.title).replace(/\.md$/i, "")
      await downloadMarkdownAsDocx(`${base}.docx`, doc.title, doc.content)
    } catch (e) {
      console.error("[canvas export docx]", e)
    } finally {
      setExporting(false)
    }
  }, [doc])

  const onEditorChange = useCallback(
    (markdown: string) => {
      updateCanvasContent(markdown)
    },
    [updateCanvasContent]
  )

  const canvasExportGroups = useMemo(
    () => [
      {
        id: "export",
        label: t("actionTabs.export"),
        items: [
          {
            id: "md",
            label: t("chat.canvas.exportMd"),
            icon: <Download className="h-3.5 w-3.5" />,
            onClick: onExportMd,
            disabled: !doc?.content.trim(),
          },
          {
            id: "doc",
            label: t("chat.canvas.exportDoc"),
            icon: <FileText className="h-3.5 w-3.5" />,
            onClick: () => void onExportDoc(),
            disabled: !doc?.content.trim() || exporting,
          },
        ],
      },
    ],
    [doc?.content, exporting, onExportDoc, onExportMd, t]
  )

  if (!doc) return null

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-sm border border-border/60 bg-card/20 shadow-[inset_0_1px_0_oklch(1_0_0/0.04)]",
        highlightPulse && "sk-canvas-panel-highlight ring-2 ring-emerald-400/40",
        className
      )}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/70 px-4 py-3 backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t("chat.canvas.title")}</div>
          <h2 className="break-words font-sans text-base font-semibold leading-snug text-foreground/95">{doc.title}</h2>
        </div>
        <div className="flex shrink-0 items-start gap-1.5">
          <ActionTabBar groups={canvasExportGroups} size="xs" className="items-end" />
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

      <div
        data-testid="scholar-canvas-scroll"
        className="min-h-0 flex-1 overflow-y-auto sk-scrollbar px-6 py-8 md:px-10"
      >
        {doc.content.trim() || doc.id ? (
          <CanvasEditor
            docId={doc.id}
            content={doc.content}
            onChange={onEditorChange}
            placeholder={t("chat.canvas.empty")}
            className="text-[15px] leading-7"
          />
        ) : (
          <div className="flex min-h-[280px] items-center justify-center">
            <WelcomeEmptyState variant="canvas" />
          </div>
        )}
      </div>
    </div>
  )
})

/** Mobile full-screen drawer for Scholar Canvas (< lg). */
export const ScholarCanvasMobileDrawer = memo(function ScholarCanvasMobileDrawer({
  highlightPulse = false,
}: {
  highlightPulse?: boolean
}) {
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
            <ScholarCanvas className="h-full rounded-none border-0" highlightPulse={highlightPulse} />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  )
})
