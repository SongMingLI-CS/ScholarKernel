"use client"

import { memo, useCallback, useEffect, useRef } from "react"
import { BookOpen, FileText, ScrollText } from "lucide-react"
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import { CanvasSharePopover } from "@/components/canvas-share-popover"
import { ComponentSandbox } from "@/components/component-sandbox"
import { PdfCoReader } from "@/components/PdfCoReader"
import { Button } from "@/components/ui/button"
import { CANVAS_EDITOR_PROSE_CLASS, CANVAS_EDITOR_ROOT_CLASS } from "@/lib/canvas-prose"
import { downloadTextFile, sanitizeExportFilename } from "@/lib/conversation-utils"
import { t as tGlobal } from "@/lib/locales"
import { htmlToMarkdown, markdownToCanvasHtml } from "@/lib/markdown-bridge"
import {
  extractReferencesFromMarkdown,
  serializeReferencesAsBibTeX,
  type AcademicReference,
} from "@/lib/utils/citation-parser"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

type CanvasEditorProps = {
  docId: string
  content: string
  onChange: (markdown: string) => void
  className?: string
  placeholder?: string
  documentTitle?: string
  references?: AcademicReference[]
  readOnly?: boolean
  onCitationActivate?: (page: number) => void
}

type CoReaderMode = "canvas" | "pdf"

const CoReaderSegmentedControl = memo(function CoReaderSegmentedControl({
  mode,
  onChange,
}: {
  mode: CoReaderMode
  onChange: (mode: CoReaderMode) => void
}) {
  return (
    <div
      className="inline-flex shrink-0 items-center rounded-sm border border-border/60 bg-zinc-950/50 p-0.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.04)]"
      role="tablist"
      aria-label={tGlobal("chat.coReader.toggleLabel")}
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "canvas"}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
          mode === "canvas"
            ? "bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_oklch(0.72_0.19_155/0.2)]"
            : "text-muted-foreground hover:text-foreground/80"
        )}
        onClick={() => onChange("canvas")}
      >
        <ScrollText className="h-3 w-3" />
        {tGlobal("chat.coReader.modeCanvas")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "pdf"}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 font-mono text-[10px] uppercase tracking-wider transition-colors",
          mode === "pdf"
            ? "bg-amber-500/15 text-amber-300 shadow-[0_0_12px_oklch(0.75_0.15_75/0.2)]"
            : "text-muted-foreground hover:text-foreground/80"
        )}
        onClick={() => onChange("pdf")}
      >
        <FileText className="h-3 w-3" />
        {tGlobal("chat.coReader.modePdf")}
      </button>
    </div>
  )
})

const CanvasEditorInner = memo(function CanvasEditorInner({
  docId,
  content,
  onChange,
  className,
  placeholder,
  documentTitle,
  references,
  readOnly = false,
  onCitationActivate,
}: CanvasEditorProps) {
  const externalSyncRef = useRef(false)
  const lastEmittedRef = useRef(content)
  const pushToast = useAgentStore((s) => s.actions.pushToast)
  const viewMode = useAgentStore((s) => s.pdfCoReader.viewMode)
  const setCoReaderViewMode = useAgentStore((s) => s.actions.setCoReaderViewMode)
  const scrollToPdfPage = useAgentStore((s) => s.actions.scrollToPdfPage)

  const editor = useEditor(
    {
      extensions: [
        StarterKit,
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      content: markdownToCanvasHtml(content),
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: CANVAS_EDITOR_PROSE_CLASS,
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (readOnly || externalSyncRef.current) return
        const md = htmlToMarkdown(ed.getHTML())
        lastEmittedRef.current = md
        onChange(md)
      },
    },
    [docId, readOnly]
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    editor.setEditable(!readOnly)
  }, [editor, readOnly])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (content === lastEmittedRef.current) return
    externalSyncRef.current = true
    editor.commands.setContent(markdownToCanvasHtml(content), { emitUpdate: false })
    lastEmittedRef.current = content
    externalSyncRef.current = false
  }, [content, editor])

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const root = editor.view.dom

    const onCitationClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      const anchor = target.closest<HTMLElement>("[data-page][data-sk-citation='page']")
      if (!anchor) return
      event.preventDefault()
      const page = Number.parseInt(anchor.getAttribute("data-page") ?? "", 10)
      if (!Number.isFinite(page) || page <= 0) return
      if (readOnly) {
        onCitationActivate?.(page)
        return
      }
      scrollToPdfPage(page)
    }

    root.addEventListener("click", onCitationClick)
    return () => root.removeEventListener("click", onCitationClick)
  }, [editor, onCitationActivate, readOnly, scrollToPdfPage])

  const gatherReferences = useCallback((): AcademicReference[] => {
    if (references?.length) return references
    const fromMd = extractReferencesFromMarkdown(content)
    if (fromMd.length) return fromMd
    return useAgentStore.getState().chat.attachedReferences
  }, [content, references])

  const onExportBibTeX = useCallback(() => {
    const refs = gatherReferences()
    if (!refs.length) {
      pushToast({ messageKey: "chat.canvas.exportCitations.empty", variant: "error", ttlMs: 3200 })
      return
    }
    const base = sanitizeExportFilename(documentTitle ?? "references").replace(/\.md$/i, "")
    downloadTextFile(`${base}.bib`, serializeReferencesAsBibTeX(refs), "application/x-bibtex;charset=utf-8")
    pushToast({ messageKey: "chat.canvas.exportCitations.done", variant: "success", ttlMs: 2400 })
  }, [documentTitle, gatherReferences, pushToast])

  const effectiveViewMode = readOnly ? "canvas" : viewMode

  if (!editor && effectiveViewMode === "canvas") {
    return (
      <div className={cn("font-mono text-sm text-muted-foreground break-words", className)}>
        {placeholder ?? "…"}
      </div>
    )
  }

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      {!readOnly ? (
        <div className="mb-3 flex shrink-0 items-center justify-between gap-2 border-b border-border/40 pb-2">
          <CoReaderSegmentedControl mode={viewMode} onChange={setCoReaderViewMode} />
          {viewMode === "canvas" ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
                onClick={onExportBibTeX}
                title={tGlobal("chat.canvas.exportBibtex")}
              >
                <BookOpen className="h-3.5 w-3.5" />
                {tGlobal("chat.canvas.exportBibtex")}
              </Button>
              <CanvasSharePopover docId={docId} />
            </div>
          ) : null}
        </div>
      ) : null}

      {effectiveViewMode === "pdf" ? (
        <PdfCoReader className="min-h-0 flex-1" />
      ) : (
        <div className={cn(CANVAS_EDITOR_ROOT_CLASS, "min-w-0 flex-1 break-words")}>
          <EditorContent editor={editor} />
        </div>
      )}
    </div>
  )
})

export const CanvasEditor = memo(function CanvasEditor(props: CanvasEditorProps) {
  if (props.readOnly) {
    return <CanvasEditorInner {...props} />
  }
  return (
    <ComponentSandbox moduleName={tGlobal("canvas.moduleName")} className="h-full min-h-0 min-w-0">
      <CanvasEditorInner {...props} />
    </ComponentSandbox>
  )
})
