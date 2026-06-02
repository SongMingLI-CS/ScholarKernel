"use client"

import { memo, useEffect, useRef } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import { htmlToMarkdown, markdownToHtml } from "@/lib/markdown-bridge"
import { cn } from "@/lib/utils"

type CanvasEditorProps = {
  docId: string
  content: string
  onChange: (markdown: string) => void
  className?: string
  placeholder?: string
}

export const CanvasEditor = memo(function CanvasEditor({
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
      extensions: [StarterKit],
      content: markdownToHtml(content),
      editorProps: {
        attributes: {
          class: cn(
            "prose prose-sm dark:prose-invert max-w-none min-h-[320px] focus:outline-none",
            "prose-headings:font-semibold prose-p:leading-8 prose-li:leading-7",
            "[&_table]:border-collapse [&_td]:border [&_td]:border-border/50 [&_td]:px-3 [&_td]:py-2",
            "[&_th]:border [&_th]:border-border/50 [&_th]:px-3 [&_th]:py-2 [&_th]:bg-muted/30"
          ),
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
    editor.commands.setContent(markdownToHtml(content), { emitUpdate: false })
    lastEmittedRef.current = content
    externalSyncRef.current = false
  }, [content, editor])

  if (!editor) {
    return (
      <div className={cn("font-mono text-sm text-muted-foreground", className)}>
        {placeholder ?? "…"}
      </div>
    )
  }

  return (
    <div className={cn("canvas-editor-root", className)}>
      <EditorContent editor={editor} />
    </div>
  )
})
