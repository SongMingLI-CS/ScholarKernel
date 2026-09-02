"use client"

import { memo, useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { CanvasEditor } from "@/components/canvas-editor"
import { fetchPublicShareDocument, type PublicShareDocument } from "@/lib/public-share-api"
import { cn } from "@/lib/utils"

function PoweredByBadge() {
  return (
    <a
      href="https://github.com/SongMingLI-CS/ScholarKernel"
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "fixed right-5 top-5 z-50 inline-flex items-center gap-2 rounded-full border border-border/50",
        "bg-background/80 px-4 py-2 font-mono text-[11px] tracking-wide text-muted-foreground shadow-lg backdrop-blur-md",
        "transition-colors hover:border-emerald-500/40 hover:text-emerald-300/90"
      )}
    >
      <span aria-hidden className="text-sm">
        ⚡
      </span>
      Powered by ScholarKernel
    </a>
  )
}

export const PublicSharePageClient = memo(function PublicSharePageClient({ token }: { token: string }) {
  const [doc, setDoc] = useState<PublicShareDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [citationHint, setCitationHint] = useState<number | null>(null)

  const onCitationActivate = useCallback((page: number) => {
    setCitationHint(page)
    window.setTimeout(() => setCitationHint(null), 3200)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchPublicShareDocument(token)
      setDoc(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setDoc(null)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load())
    return () => window.cancelAnimationFrame(frame)
  }, [load])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <PoweredByBadge />
        <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-400/80" />
          正在加载分享文档…
        </div>
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <PoweredByBadge />
        <h1 className="font-sans text-2xl font-semibold tracking-tight text-foreground/90">链接已失效</h1>
        <p className="mt-3 max-w-md font-mono text-sm leading-relaxed text-muted-foreground">
          该分享链接不存在、已被作者关闭，或已过期。请联系文档所有者获取新的访问链接。
        </p>
      </div>
    )
  }

  return (
    <article className="relative mx-auto min-h-screen max-w-3xl px-6 py-16 md:px-10 md:py-20 lg:max-w-4xl">
      <PoweredByBadge />

      <header className="mb-12 border-b border-border/30 pb-8">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400/70">Shared Report</p>
        <h1 className="break-words font-sans text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          {doc.title}
        </h1>
        <p className="mt-4 font-mono text-[11px] text-muted-foreground/80">
          只读分享 · v{doc.version} · 更新于 {new Date(doc.updatedAt).toLocaleString()}
        </p>
      </header>

      <div className="prose-share">
        {citationHint != null ? (
          <div
            role="status"
            className="mb-4 rounded-lg border border-amber-500/30 bg-amber-950/20 px-4 py-2 font-mono text-[11px] text-amber-300/90"
          >
            引用页码：第 {citationHint} 页
          </div>
        ) : null}
        <CanvasEditor
          docId={`share-${token}`}
          content={doc.content}
          onChange={() => {}}
          readOnly
          documentTitle={doc.title}
          onCitationActivate={onCitationActivate}
          className="text-[17px] leading-[1.85] md:text-[18px]"
        />
      </div>
    </article>
  )
})
