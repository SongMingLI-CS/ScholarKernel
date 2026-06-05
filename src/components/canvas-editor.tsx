"use client"

import { memo, useEffect, useRef } from "react"
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import { ComponentSandbox } from "@/components/component-sandbox"
import { CANVAS_EDITOR_PROSE_CLASS, CANVAS_EDITOR_ROOT_CLASS } from "@/lib/canvas-prose"
import { t as tGlobal } from "@/lib/locales"
import { htmlToMarkdown, markdownToCanvasHtml } from "@/lib/markdown-bridge"
import { cn } from "@/lib/utils"

type CanvasEditorProps = {
  docId: string
  content: string
  onChange: (markdown: string) => void
  className?: string
  placeholder?: string
}

const CanvasEditorInner = memo(function CanvasEditorInner({
  docId,
  content,
  onChange,
  className,
  placeholder,
}: CanvasEditorProps) {
  const externalSyncRef = useRef(false)
  const lastEmittedRef = useRef(content)

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

  if (!editor) {
    return (
      <div className={cn("font-mono text-sm text-muted-foreground break-words", className)}>
        {placeholder ?? "…"}
      </div>
    )
  }

  return (
    <div className={cn(CANVAS_EDITOR_ROOT_CLASS, "min-w-0 break-words", className)}>
      <EditorContent editor={editor} />
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
