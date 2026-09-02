"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { BookOpen, FolderOpen, Loader2, Plus, Tag, Trash2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import { deleteLibraryDocument, fetchLibraryDocuments, patchLibraryDocument, uploadLibraryDocument } from "@/lib/library-api"
import {
  collectLibraryFolders,
  filterLibraryByFolder,
  formatFileSize,
  type LibraryDocumentRecord,
  type LibraryFolderFilter,
} from "@/lib/my-library"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

const FOLDER_ITEMS: Array<{ id: LibraryFolderFilter; labelKey: "library.folder.all" | "library.folder.uncategorized" }> = [
  { id: "all", labelKey: "library.folder.all" },
  { id: "uncategorized", labelKey: "library.folder.uncategorized" },
]

function LibraryCard({
  doc,
  onDelete,
  onEditTags,
}: {
  doc: LibraryDocumentRecord
  onDelete: (id: string) => void
  onEditTags: (id: string, tags: string[]) => void
}) {
  const t = useT()
  const created = new Date(doc.createdAt).toLocaleDateString()

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 hover:border-emerald-500/30 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[13px] font-semibold text-foreground/95">{doc.title}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{formatFileSize(doc.fileSize)}</span>
            <span aria-hidden>·</span>
            <span>{created}</span>
            <span aria-hidden>·</span>
            <span className="uppercase">{doc.fileType.split("/").pop() || doc.fileType}</span>
          </div>
          {doc.tags.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {doc.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-200/90"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 border-zinc-700/80 bg-zinc-900/50"
            title={t("library.tags.manage")}
            onClick={() => {
              const raw = window.prompt(t("library.tags.prompt"), doc.tags.join(", "))
              if (raw == null) return
              const tags = raw.split(",").map((x) => x.trim()).filter(Boolean)
              onEditTags(doc.id, tags)
            }}
          >
            <Tag className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="h-8 w-8 border-rose-500/30 bg-rose-500/5 text-rose-300 hover:bg-rose-500/15"
            title={t("library.delete")}
            onClick={() => onDelete(doc.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}

export const MyLibraryPanel = memo(function MyLibraryPanel() {
  const t = useT()
  const pushToast = useAgentStore((s) => s.actions.pushToast)
  const [docs, setDocs] = useState<LibraryDocumentRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [activeFolder, setActiveFolder] = useState<LibraryFolderFilter>("all")
  const fileRef = useRef<HTMLInputElement | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchLibraryDocuments("all")
      setDocs(res.items)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast({ messageKey: "library.load.failed", detail: msg, variant: "error", ttlMs: 4200 })
    } finally {
      setLoading(false)
    }
  }, [pushToast])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void reload())
    return () => window.cancelAnimationFrame(frame)
  }, [reload])

  const customFolders = useMemo(() => collectLibraryFolders(docs), [docs])
  const visible = useMemo(() => filterLibraryByFolder(docs, activeFolder), [docs, activeFolder])

  const onUpload = useCallback(
    async (file: File | null) => {
      if (!file) return
      setUploading(true)
      try {
        const saved = await uploadLibraryDocument(file)
        setDocs((prev) => [saved, ...prev])
        pushToast({ messageKey: "library.upload.done", variant: "success", ttlMs: 2400 })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        pushToast({ messageKey: "library.upload.failed", detail: msg, variant: "error", ttlMs: 4200 })
      } finally {
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ""
      }
    },
    [pushToast]
  )

  const onDelete = useCallback(
    async (id: string) => {
      if (!window.confirm(t("library.delete.confirm"))) return
      try {
        await deleteLibraryDocument(id)
        setDocs((prev) => prev.filter((d) => d.id !== id))
        pushToast({ messageKey: "library.delete.done", variant: "success", ttlMs: 2400 })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        pushToast({ messageKey: "library.delete.failed", detail: msg, variant: "error", ttlMs: 4200 })
      }
    },
    [pushToast, t]
  )

  const onEditTags = useCallback(
    async (id: string, tags: string[]) => {
      try {
        const updated = await patchLibraryDocument(id, { tagsReplace: tags })
        setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, tags: updated.tags } : d)))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        pushToast({ messageKey: "library.tags.failed", detail: msg, variant: "error", ttlMs: 4200 })
      }
    },
    [pushToast]
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border/60 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wide">
              <BookOpen className="h-4 w-4 text-emerald-400" />
              {t("library.title")}
            </div>
            <p className="mt-1 max-w-2xl font-mono text-[11px] text-muted-foreground">{t("library.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,.tex,.bib,.ris"
              onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
            />
            <Button
              type="button"
              className="gap-2 font-mono text-[12px]"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {t("library.upload")}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-border/60 bg-background/20 p-3 sk-scrollbar">
          <div className="mb-2 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
            {t("library.folders")}
          </div>
          <nav className="space-y-1">
            {FOLDER_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveFolder(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-mono text-[11px] transition-colors",
                  activeFolder === item.id
                    ? "bg-emerald-500/10 text-emerald-200/95 shadow-[inset_0_0_0_1px_oklch(0.72_0.17_155/0.35)]"
                    : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                )}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            ))}
            {customFolders.map((folder) => (
              <button
                key={folder}
                type="button"
                onClick={() => setActiveFolder(folder)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-mono text-[11px] transition-colors",
                  activeFolder === folder
                    ? "bg-emerald-500/10 text-emerald-200/95 shadow-[inset_0_0_0_1px_oklch(0.72_0.17_155/0.35)]"
                    : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
                )}
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{folder}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto p-4 sk-scrollbar">
          {loading ? (
            <div className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("library.loading")}
            </div>
          ) : visible.length === 0 ? (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-zinc-700/80 bg-zinc-900/30 p-8 text-center">
              <Plus className="h-8 w-8 text-muted-foreground/60" />
              <div className="font-mono text-[12px] text-muted-foreground">{t("library.empty")}</div>
              <Button type="button" variant="outline" className="font-mono text-[11px]" onClick={() => fileRef.current?.click()}>
                {t("library.upload")}
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((doc) => (
                <LibraryCard key={doc.id} doc={doc} onDelete={(id) => void onDelete(id)} onEditTags={(id, tags) => void onEditTags(id, tags)} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
})
