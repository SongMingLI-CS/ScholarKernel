"use client"

import { memo, useCallback, useEffect, useRef } from "react"
import { BookOpen } from "lucide-react"
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import { ComponentSandbox } from "@/components/component-sandbox"
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
}

const CanvasEditorInner = memo(function CanvasEditorInner({
  docId,
  content,
  onChange,
  className,
  placeholder,
  documentTitle,
  references,
}: CanvasEditorProps) {
  const externalSyncRef = useRef(false)
  const lastEmittedRef = useRef(content)
  const pushToast = useAgentStore((s) => s.actions.pushToast)

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
      editorProps: {
        attributes: {
          class: CANVAS_EDITOR_PROSE_CLASS,
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (externalSyncRef.current) return
        const md = htmlToMarkdown(ed.getHTML())
        lastEmittedRef.current = md
        onChange(md)
      },
    },
    [docId]
  )

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (content === lastEmittedRef.current) return
    externalSyncRef.current = true
    editor.commands.setContent(markdownToCanvasHtml(content), { emitUpdate: false })
    lastEmittedRef.current = content
    externalSyncRef.current = false
  }, [content, editor])

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

  if (!editor) {
    return (
      <div className={cn("font-mono text-sm text-muted-foreground break-words", className)}>
        {placeholder ?? "…"}
      </div>
    )
  }

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <div className="mb-3 flex shrink-0 items-center justify-end gap-2 border-b border-border/40 pb-2">
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
      </div>
      <div className={cn(CANVAS_EDITOR_ROOT_CLASS, "min-w-0 flex-1 break-words")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
})

export const CanvasEditor = memo(function CanvasEditor(props: CanvasEditorProps) {
  return (
    <ComponentSandbox moduleName={tGlobal("canvas.moduleName")} className="h-full min-h-0 min-w-0">
      <CanvasEditorInner {...props} />
    </ComponentSandbox>
  )
})
