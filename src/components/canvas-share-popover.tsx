"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy, Link2, Loader2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { disableCanvasShare, enableCanvasShare, type ShareLinkPayload } from "@/lib/public-share-api"
import { t as tGlobal } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

export const CanvasSharePopover = memo(function CanvasSharePopover({ docId }: { docId: string }) {
  const pushToast = useAgentStore((s) => s.actions.pushToast)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [link, setLink] = useState<ShareLinkPayload | null>(null)
  const [copied, setCopied] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const onOpen = useCallback(async () => {
    setOpen(true)
    setCopied(false)
    setLoading(true)
    try {
      const payload = await enableCanvasShare(docId)
      setLink(payload)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast({ messageKey: "chat.canvas.share.failed", detail: msg, variant: "error", ttlMs: 4200 })
      setOpen(false)
    } finally {
      setLoading(false)
    }
  }, [docId, pushToast])

  const onCopy = useCallback(async () => {
    if (!link?.shareUrl) return
    try {
      await navigator.clipboard.writeText(link.shareUrl)
      setCopied(true)
      pushToast({ messageKey: "chat.canvas.share.copied", variant: "success", ttlMs: 2400 })
      window.setTimeout(() => setCopied(false), 2400)
    } catch {
      pushToast({ messageKey: "chat.canvas.share.copyFailed", variant: "error", ttlMs: 3200 })
    }
  }, [link?.shareUrl, pushToast])

  const onRevoke = useCallback(async () => {
    setLoading(true)
    try {
      await disableCanvasShare(docId)
      setLink(null)
      setOpen(false)
      pushToast({ messageKey: "chat.canvas.share.revoked", variant: "success", ttlMs: 2800 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      pushToast({ messageKey: "chat.canvas.share.failed", detail: msg, variant: "error", ttlMs: 4200 })
    } finally {
      setLoading(false)
    }
  }, [docId, pushToast])

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
        title={tGlobal("chat.canvas.share.title")}
        onClick={() => void onOpen()}
      >
        <Link2 className="h-3.5 w-3.5" />
        {tGlobal("chat.canvas.share.button")}
      </Button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(380px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border/70 bg-popover shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
            <div className="font-mono text-[12px] font-semibold">{tGlobal("chat.canvas.share.title")}</div>
            <button
              type="button"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background/60"
              onClick={() => setOpen(false)}
              aria-label="close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 px-3 py-3">
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {tGlobal("chat.canvas.share.hint")}
            </p>

            {loading && !link ? (
              <div className="flex items-center gap-2 py-2 font-mono text-[11px] text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {tGlobal("chat.canvas.share.generating")}
              </div>
            ) : link ? (
              <div className="rounded-lg border border-border/50 bg-background/40 p-2.5">
                <code className="block break-all font-mono text-[10px] leading-relaxed text-emerald-300/90">
                  {link.shareUrl}
                </code>
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-mono text-[10px] text-muted-foreground"
                disabled={loading || !link}
                onClick={() => void onRevoke()}
              >
                {tGlobal("chat.canvas.share.revoke")}
              </Button>
              <Button
                type="button"
                size="sm"
                className={cn("gap-1.5 font-mono text-[11px]", copied && "border-emerald-500/50")}
                disabled={loading || !link?.shareUrl}
                onClick={() => void onCopy()}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? tGlobal("chat.canvas.share.copied") : tGlobal("chat.canvas.share.copy")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})
