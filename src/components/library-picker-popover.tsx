"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { BookMarked, Check, Loader2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { fetchLibraryDocuments } from "@/lib/library-api"
import { formatFileSize, type LibraryDocumentRecord } from "@/lib/my-library"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

export const LibraryPickerPopover = memo(function LibraryPickerPopover({
  disabled,
}: {
  disabled?: boolean
}) {
  const t = useT()
  const pushToast = useAgentStore((s) => s.actions.pushToast)
  const selected = useAgentStore((s) => s.chat.selectedLibraryDocuments)
  const setSelected = useAgentStore((s) => s.actions.setSelectedLibraryDocuments)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [docs, setDocs] = useState<LibraryDocumentRecord[]>([])
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set())
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setDraftIds(new Set(selected.map((d) => d.id)))
    setLoading(true)
    void fetchLibraryDocuments("all")
      .then((res) => setDocs(res.items))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e)
        pushToast({ messageKey: "library.load.failed", detail: msg, variant: "error", ttlMs: 4200 })
      })
      .finally(() => setLoading(false))
  }, [open, pushToast, selected])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const toggle = useCallback((id: string) => {
    setDraftIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const onConfirm = useCallback(() => {
    const picked = docs.filter((d) => draftIds.has(d.id)).map((d) => ({ id: d.id, title: d.title }))
    setSelected(picked)
    setOpen(false)
    if (picked.length) {
      pushToast({
        messageKey: "library.picker.done",
        detail: String(picked.length),
        variant: "success",
        ttlMs: 2400,
      })
    }
  }, [docs, draftIds, pushToast, setSelected])

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-11 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
        disabled={disabled}
        title={t("library.picker.hint")}
        onClick={() => setOpen((v) => !v)}
      >
        <BookMarked className="h-4 w-4" />
      </Button>

      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/70 bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
            <div className="font-mono text-[12px] font-semibold">{t("library.picker.title")}</div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60"
              onClick={() => setOpen(false)}
              aria-label="close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[280px] overflow-y-auto sk-scrollbar p-2">
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-4 font-mono text-[11px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("library.loading")}
              </div>
            ) : docs.length === 0 ? (
              <div className="px-2 py-4 font-mono text-[11px] text-muted-foreground">{t("library.picker.empty")}</div>
            ) : (
              <ul className="space-y-1">
                {docs.map((doc) => {
                  const checked = draftIds.has(doc.id)
                  return (
                    <li key={doc.id}>
                      <button
                        type="button"
                        onClick={() => toggle(doc.id)}
                        className={cn(
                          "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                          checked ? "bg-emerald-500/10" : "hover:bg-background/50"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            checked
                              ? "border-emerald-400/70 bg-emerald-500/20 text-emerald-300"
                              : "border-border/70 bg-background/40"
                          )}
                        >
                          {checked ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[11px] font-medium">{doc.title}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                            {formatFileSize(doc.fileSize)}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2.5">
            <span className="font-mono text-[10px] text-muted-foreground">
              {t("library.picker.selected", { count: draftIds.size })}
            </span>
            <Button type="button" size="sm" className="font-mono text-[11px]" onClick={onConfirm}>
              {t("library.picker.confirm")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
})
