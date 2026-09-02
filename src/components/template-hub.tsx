"use client"

import { memo, useCallback, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Gavel, Paperclip, PenLine, Pickaxe, Sparkles, X, Zap, type LucideIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import { ACADEMIC_TEMPLATES, type AcademicTemplate } from "@/config/presets"
import { Button } from "@/components/ui/button"
import { formatFileAttachmentBlock, isLayoutAwareUpload, readBrowserFileAsText } from "@/lib/browser-file"
import { useT } from "@/lib/locales"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"

const ICON_MAP: Record<string, LucideIcon> = {
  Gavel,
  Pickaxe,
  PenLine,
}

function TemplateIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Sparkles
  return <Icon className={className} />
}

const CATEGORY_LABEL: Record<AcademicTemplate["category"], string> = {
  "peer-review": "顶会审稿",
  grant: "基金本子",
  revision: "大修回复",
}

type TemplateHubProps = {
  variant?: "embedded" | "page"
  onLaunch?: (input: string) => void | Promise<void>
  className?: string
}

export const TemplateHub = memo(function TemplateHub({
  variant = "embedded",
  onLaunch,
  className,
}: TemplateHubProps) {
  const t = useT()
  const router = useRouter()
  const createConversation = useAgentStore((s) => s.actions.createConversation)
  const setActivePanel = useAgentStore((s) => s.actions.setActivePanel)
  const [selected, setSelected] = useState<AcademicTemplate | null>(null)
  const [input, setInput] = useState("")
  const [launching, setLaunching] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSelect = useCallback((template: AcademicTemplate) => {
    setSelected((cur) => (cur?.id === template.id ? null : template))
    setInput("")
  }, [])

  const handleLaunch = useCallback(async () => {
    if (!selected || !input.trim() || launching) return
    setLaunching(true)
    try {
      const conv = await createConversation({ templateId: selected.id })
      setActivePanel("chat")
      router.push(`/?c=${conv.id}`)
      await onLaunch?.(input.trim())
    } finally {
      setLaunching(false)
    }
  }, [createConversation, input, launching, onLaunch, router, selected, setActivePanel])

  const onPickFile = useCallback(async (file: File) => {
    try {
      const text = await readBrowserFileAsText(file)
      const block = formatFileAttachmentBlock(file.name, text)
      setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${block}` : block))
      if (isLayoutAwareUpload(file.name)) {
        useAgentStore.getState().actions.setSessionPdfUrl({ url: URL.createObjectURL(file), name: file.name })
      }
    } catch {
      useAgentStore.getState().actions.pushToast({
        messageKey: "chat.upload.failed",
        variant: "error",
        ttlMs: 4200,
      })
    }
  }, [])

  const isPage = variant === "page"

  return (
    <div className={cn("relative", isPage ? "mx-auto max-w-6xl px-4 py-8" : "w-full", className)}>
      <div className={cn("mb-6", isPage ? "text-center" : "px-1")}>
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/8 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-amber-200/90">
          <Sparkles className="h-3 w-3" />
          {t("workshop.badge")}
        </div>
        <h2 className={cn("mt-3 font-semibold tracking-tight text-foreground", isPage ? "text-2xl" : "text-lg")}>
          {t("workshop.title")}
        </h2>
        <p className={cn("mt-2 text-muted-foreground", isPage ? "text-sm" : "text-xs leading-relaxed")}>
          {t("workshop.subtitle")}
        </p>
      </div>

      <div
        className={cn(
          "grid gap-3",
          isPage ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1 lg:grid-cols-3"
        )}
      >
        {ACADEMIC_TEMPLATES.map((template, idx) => {
          const active = selected?.id === template.id
          return (
            <motion.button
              key={template.id}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06, duration: 0.28 }}
              onClick={() => handleSelect(template)}
              className={cn(
                "group relative overflow-hidden rounded-xl border bg-zinc-900 p-4 text-left transition-all cursor-pointer",
                "border-zinc-800 hover:border-amber-500/50 hover:shadow-[0_0_20px_rgba(245,158,11,0.05)]",
                active && "border-amber-500/60 shadow-[0_0_24px_rgba(245,158,11,0.08)] ring-1 ring-amber-500/30",
                idx === 0 && isPage && "sm:col-span-2 lg:col-span-1 lg:row-span-1"
              )}
            >
              <div
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
                style={{
                  background:
                    "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(245,158,11,0.06), transparent 70%)",
                }}
                aria-hidden
              />
              <div className="relative flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-300">
                  <TemplateIcon name={template.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-foreground/95">{template.title}</span>
                    <span className="rounded-sm border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                      {CATEGORY_LABEL[template.category]}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">{template.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {template.initialAgents.map((agent) => (
                      <span
                        key={agent.id}
                        className="rounded-sm border border-zinc-700/80 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500"
                      >
                        {agent.title.split("·")[0]?.trim() ?? agent.title}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </motion.button>
          )
        })}
      </div>

      <AnimatePresence>
        {selected ? (
          <motion.div
            key={selected.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22 }}
            className={cn(
              "mt-5 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/95 shadow-[0_8px_40px_rgba(0,0,0,0.35)]",
              isPage ? "mx-auto max-w-3xl" : ""
            )}
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <TemplateIcon name={selected.icon} className="h-4 w-4 shrink-0 text-amber-400" />
                <span className="truncate font-mono text-[12px] font-medium text-foreground">{selected.title}</span>
              </div>
              <button
                type="button"
                aria-label="close"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                onClick={() => setSelected(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={selected.defaultInputPlaceholder}
                rows={isPage ? 5 : 4}
                className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950/80 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground outline-none placeholder:text-zinc-600 focus-visible:border-amber-500/40 focus-visible:ring-2 focus-visible:ring-amber-500/15"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.md,.tex,.docx"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void onPickFile(f)
                      e.target.value = ""
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 border-zinc-700 bg-zinc-800/50 font-mono text-[11px] hover:border-amber-500/30"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    PDF / 文档
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!input.trim() || launching}
                  className="h-9 gap-2 bg-amber-600 font-mono text-[12px] hover:bg-amber-500 disabled:opacity-50"
                  onClick={() => void handleLaunch()}
                >
                  <Zap className="h-4 w-4" />
                  {launching ? t("workshop.launching") : t("workshop.launch")}
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
})

export type WorkshopPanelProps = {
  onLaunch?: (input: string) => void | Promise<void>
}

export const WorkshopPanel = memo(function WorkshopPanel({ onLaunch }: WorkshopPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sk-scrollbar">
      <TemplateHub variant="page" onLaunch={onLaunch} />
    </div>
  )
})
