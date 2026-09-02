"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Activity,
  Cpu,
  KeyRound,
  LayoutGrid,
  MessageSquareText,
  MoreHorizontal,
  Network,
  BookOpen,
  PenTool,
  Pin,
  PinOff,
  Plus,
  Pencil,
  Search,
  Settings,
  Shield,
  Trash2,
  Zap,
  X,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"

import { FeatureManifestDialog } from "@/components/feature-manifest"
import { SetupGuide } from "@/components/setup-guide"
import { WelcomeEmptyState } from "@/components/welcome-empty-state"
import { Button } from "@/components/ui/button"
import { CloudMetrics } from "@/components/cloud-metrics"
import { useT, type LocaleKey } from "@/lib/locales"
import { filterConversationsByQuery } from "@/lib/conversation-utils"
import { cn } from "@/lib/utils"
import { useAgentStore, type PanelId } from "@/store/useAgentStore"
import type { ConversationSummary } from "@/lib/db-types"

type NavItem = {
  id: PanelId
  label: LocaleKey
  icon: ComponentType<{ className?: string }>
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: "dashboard", label: "nav.dashboard", icon: Activity },
  { id: "chat", label: "nav.chat", icon: MessageSquareText },
  { id: "workshop", label: "nav.workshop", icon: PenTool },
  { id: "keys", label: "nav.keys", icon: KeyRound },
  { id: "models", label: "nav.models", icon: Cpu },
  { id: "settings", label: "nav.settings", icon: Settings },
] as const

function formatRelativeTime(iso: string | Date, tr: (key: LocaleKey, vars?: Record<string, string | number>) => string) {
  const d = typeof iso === "string" ? new Date(iso) : iso
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return tr("sidebar.time.justNow")
  if (mins < 60) return tr("sidebar.time.minsAgo", { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return tr("sidebar.time.hoursAgo", { n: hrs })
  const days = Math.floor(hrs / 24)
  if (days < 7) return tr("sidebar.time.daysAgo", { n: days })
  return d.toLocaleDateString()
}

const ConversationItem = memo(function ConversationItem({
  item,
  active,
  onSelect,
  onRename,
  onTogglePin,
  onDelete,
  formatTime,
}: {
  item: ConversationSummary
  active: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onTogglePin: (id: string, isPinned: boolean) => void
  onDelete: (id: string) => void
  formatTime: (iso: string | Date) => string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.title)
  const menuRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(item.title)
  }, [item.title])

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [menuOpen])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const commitRename = useCallback(() => {
    const next = draft.trim() || "新对话"
    setEditing(false)
    if (next !== item.title) onRename(item.id, next)
  }, [draft, item.id, item.title, onRename])

  return (
    <div
      className={cn(
        "group relative flex items-center gap-1 rounded-lg px-2 py-2 transition-colors",
        active
          ? "bg-sidebar-primary/12 shadow-[inset_0_0_0_1px_oklch(0.488_0.243_264.376/0.28)]"
          : "hover:bg-background/40"
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => !editing && onSelect(item.id)}
        onDoubleClick={(e) => {
          e.preventDefault()
          setEditing(true)
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") {
                setDraft(item.title)
                setEditing(false)
              }
            }}
            className="w-full rounded-md border border-sidebar-primary/40 bg-background/60 px-2 py-1 font-mono text-[12px] outline-none ring-sidebar-primary/30 focus:ring-2"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <div className="truncate font-mono text-[12px] font-medium text-foreground/95">{item.title}</div>
            <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {formatTime(item.updatedAt)}
            </div>
          </>
        )}
      </button>

      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          aria-label="conversation menu"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-background/50 hover:text-foreground",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>

        <AnimatePresence>
          {menuOpen ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 top-full z-50 mt-1 min-w-[148px] overflow-hidden rounded-lg border border-border/70 bg-popover py-1 shadow-xl"
            >
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 font-mono text-[11px] hover:bg-background/60"
                onClick={() => {
                  onTogglePin(item.id, !item.isPinned)
                  setMenuOpen(false)
                }}
              >
                {item.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                {item.isPinned ? "取消置顶" : "置顶"}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 font-mono text-[11px] hover:bg-background/60"
                onClick={() => {
                  setEditing(true)
                  setMenuOpen(false)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                重命名
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 font-mono text-[11px] text-rose-300 hover:bg-rose-500/10"
                onClick={() => {
                  onDelete(item.id)
                  setMenuOpen(false)
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
})

export const Sidebar = memo(function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const active = useAgentStore((s) => s.ui.activePanel)
  const setActive = useAgentStore((s) => s.actions.setActivePanel)
  const goPanel = useCallback(
    (panel: PanelId) => {
      setActive(panel)
      onNavigate?.()
    },
    [onNavigate, setActive]
  )
  const conversations = useAgentStore((s) => s.conversations.items)
  const currentConversationId = useAgentStore((s) => s.conversations.currentId)
  const conversationsLoading = useAgentStore((s) => s.conversations.loading)
  const runtimeKeys = useAgentStore((s) => s.runtimeKeys)
  const {
    initializeCloud,
    createConversation,
    switchConversation,
    renameConversation,
    togglePinConversation,
    deleteConversation,
  } = useAgentStore((s) => s.actions)

  const [mounted, setMounted] = useState(false)
  const [now, setNow] = useState<number | null>(null)
  const [manifestOpen, setManifestOpen] = useState(false)
  const [quickStartOpen, setQuickStartOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleNewConversation = useCallback(() => {
    void (async () => {
      const conv = await createConversation()
      goPanel("chat")
      router.push(`/?c=${conv.id}`)
    })()
  }, [createConversation, goPanel, router])

  useEffect(() => {
    setMounted(true)
    setNow(Date.now())
    void initializeCloud()
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [initializeCloud])

  useEffect(() => {
    const c = searchParams.get("c")
    if (c && c !== currentConversationId) {
      void switchConversation(c)
    }
  }, [searchParams, currentConversationId, switchConversation])

  useEffect(() => {
    if (!quickStartOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setQuickStartOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [quickStartOpen])

  const timeLabel = useMemo(() => {
    if (!mounted || now == null) return ""
    const d = new Date(now)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  }, [mounted, now])

  const cryptoReady = mounted && runtimeKeys != null

  const filteredConversations = useMemo(
    () => filterConversationsByQuery(conversations, searchQuery),
    [conversations, searchQuery]
  )
  const pinned = useMemo(() => filteredConversations.filter((c) => c.isPinned), [filteredConversations])
  const recent = useMemo(() => filteredConversations.filter((c) => !c.isPinned), [filteredConversations])
  const searchActive = searchQuery.trim().length > 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && e.shiftKey) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !e.shiftKey) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
        if (tag === "input" || tag === "textarea" || (e.target as HTMLElement | null)?.isContentEditable) return
        e.preventDefault()
        void handleNewConversation()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleNewConversation])

  const handleSelectConversation = useCallback(
    (id: string) => {
      goPanel("chat")
      router.push(`/?c=${id}`)
    },
    [goPanel, router]
  )

  const formatTime = useCallback((iso: string | Date) => formatRelativeTime(iso, t), [t])

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      if (typeof window !== "undefined" && !window.confirm(t("sidebar.delete.confirm"))) return
      const wasCurrent = id === currentConversationId
      try {
        await deleteConversation(id)
        if (wasCurrent) router.push("/")
      } catch {
        // toast already shown in store
      }
    },
    [currentConversationId, deleteConversation, router, t]
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-2.5 w-2.5 rounded-full bg-sidebar-primary shadow-[0_0_0_3px_oklch(0.488_0.243_264.376/0.15),0_0_24px_oklch(0.488_0.243_264.376/0.45)]"
              aria-hidden
            />
            <div className="truncate font-mono text-sm font-semibold tracking-wide">ScholarKernel</div>
          </div>
          <div className="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Network className="h-3.5 w-3.5" />
            <span className="truncate">{t("sidebar.tagline")}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-xs text-muted-foreground">
          {mounted ? (
            <span className="inline-flex items-center gap-1 rounded-sm border border-border/60 bg-background/40 px-2 py-1">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
              {timeLabel}
            </span>
          ) : null}
        </div>
      </header>

      <section className="space-y-2">
        <motion.div whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 520, damping: 28 }}>
          <Button
            variant="outline"
            className="h-10 w-full justify-start gap-2 rounded-xl border-sidebar-primary/35 bg-gradient-to-r from-sidebar-primary/10 to-transparent font-mono text-[13px] shadow-[inset_0_0_0_1px_oklch(0.488_0.243_264.376/0.22)] hover:from-sidebar-primary/16"
            onClick={() => handleNewConversation()}
          >
            <Plus className="h-4 w-4 text-sidebar-primary" />
            <span>新建对话</span>
          </Button>
        </motion.div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("sidebar.search.placeholder")}
            className="h-9 w-full rounded-lg border border-border/60 bg-background/40 pl-8 pr-3 font-mono text-[12px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-sidebar-primary/30"
            aria-label={t("sidebar.search.placeholder")}
          />
        </div>

        <div className="max-h-[280px] overflow-y-auto sk-scrollbar pr-0.5">
          {conversationsLoading && conversations.length === 0 ? (
            <div className="px-2 py-3 font-mono text-[11px] text-muted-foreground">加载会话…</div>
          ) : conversations.length === 0 ? (
            <WelcomeEmptyState variant="sidebar" className="mx-1" />
          ) : searchActive && filteredConversations.length === 0 ? (
            <div className="px-2 py-3 font-mono text-[11px] text-muted-foreground">{t("sidebar.search.empty")}</div>
          ) : (
            <div className="space-y-3">
              {pinned.length > 0 ? (
                <div>
                  <div className="mb-1.5 px-2 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
                    已置顶
                  </div>
                  <div className="space-y-0.5">
                    {pinned.map((item) => (
                      <ConversationItem
                        key={item.id}
                        item={item}
                        active={item.id === currentConversationId}
                        onSelect={handleSelectConversation}
                        onRename={(id, title) => void renameConversation(id, title)}
                        onTogglePin={(id, isPinned) => void togglePinConversation(id, isPinned)}
                        onDelete={(id) => void handleDeleteConversation(id)}
                        formatTime={formatTime}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {recent.length > 0 ? (
                <div>
                  <div className="mb-1.5 px-2 font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">
                    最近对话
                  </div>
                  <div className="space-y-0.5">
                    {recent.map((item) => (
                      <ConversationItem
                        key={item.id}
                        item={item}
                        active={item.id === currentConversationId}
                        onSelect={handleSelectConversation}
                        onRename={(id, title) => void renameConversation(id, title)}
                        onTogglePin={(id, isPinned) => void togglePinConversation(id, isPinned)}
                        onDelete={(id) => void handleDeleteConversation(id)}
                        formatTime={formatTime}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <nav className="grid gap-2">
        {NAV_ITEMS.map((it) => {
          const Icon = it.icon
          const isActive = it.id === active
          const isWorkshop = it.id === "workshop"
          return (
            <div key={it.id} className="space-y-2">
              <motion.div whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 520, damping: 28 }}>
                <Button
                  variant="outline"
                  className={cn(
                    "h-10 w-full justify-start gap-2 rounded-sm border-border/60 bg-background/30 font-mono text-[13px] hover:bg-background/60",
                    isActive &&
                      "border-sidebar-primary/50 bg-sidebar-primary/10 shadow-[inset_0_0_0_1px_oklch(0.488_0.243_264.376/0.35)]"
                  )}
                  onClick={() => goPanel(it.id)}
                >
                  <Icon className="h-4 w-4" />
                  <span className="truncate">{t(it.label)}</span>
                </Button>
              </motion.div>
              {isWorkshop ? (
                <motion.div whileTap={{ scale: 0.985 }} transition={{ type: "spring", stiffness: 520, damping: 28 }}>
                  <Button
                    variant="outline"
                    className={cn(
                      "h-10 w-full justify-start gap-2 rounded-sm border-border/60 bg-background/30 font-mono text-[13px] hover:bg-background/60",
                      active === "library" &&
                        "border-emerald-500/40 bg-emerald-500/10 shadow-[inset_0_0_0_1px_oklch(0.72_0.17_155/0.35)]"
                    )}
                    onClick={() => {
                      goPanel("library")
                      router.push("/workshop/library")
                    }}
                  >
                    <BookOpen className="h-4 w-4 text-emerald-400" />
                    <span className="truncate">{t("nav.library")}</span>
                  </Button>
                </motion.div>
              ) : null}
            </div>
          )
        })}
      </nav>

      <section className="mt-2">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[10px] font-semibold tracking-wider text-muted-foreground">{t("sidebar.cloudMetrics.title")}</div>
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 sk-conn-dot" aria-hidden />
            {t("sidebar.cloudMetrics.live")}
          </span>
        </div>
        <CloudMetrics />
      </section>

      <footer className="mt-auto space-y-3">
        <div
          className={cn(
            "flex items-center justify-between rounded-sm border px-3 py-2 font-mono text-[11px]",
            cryptoReady
              ? "border-emerald-500/35 bg-emerald-500/[0.07] text-emerald-200/90"
              : "border-rose-500/35 bg-rose-500/[0.06] text-rose-200/90"
          )}
        >
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 shrink-0 opacity-90" />
            <div className="min-w-0">
              <div className="font-semibold tracking-wide">{t("sidebar.securityLock")}</div>
              <div className="truncate text-[10px] opacity-90">
                {cryptoReady ? t("sidebar.securityLock.synced") : t("sidebar.securityLock.missing")}
              </div>
            </div>
          </div>
          <span className="relative inline-flex h-3 w-3 shrink-0">
            <span
              className={cn(
                "absolute inset-0 rounded-full",
                cryptoReady ? "bg-emerald-400 shadow-[0_0_12px_oklch(0.78_0.2_145/0.65)]" : "bg-rose-500 shadow-[0_0_12px_oklch(0.65_0.22_25/0.55)]"
              )}
              aria-hidden
            />
            {!cryptoReady ? <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/40" aria-hidden /> : null}
          </span>
        </div>

        <motion.div whileTap={{ scale: 0.988 }} transition={{ type: "spring", stiffness: 520, damping: 30 }}>
          <Button
            variant="outline"
            className="h-10 w-full justify-start gap-2 rounded-sm border-border/60 bg-background/25 font-mono text-[12px] hover:bg-background/60"
            onClick={() => setManifestOpen(true)}
          >
            <LayoutGrid className="h-4 w-4" />
            <span className="truncate">{t("sidebar.systemManifest")}</span>
          </Button>
        </motion.div>

        <div className="flex items-center justify-between gap-2">
          <motion.div whileTap={{ scale: 0.988 }} transition={{ type: "spring", stiffness: 520, damping: 30 }} className="min-w-0 flex-1">
            <Button
              variant="outline"
              className="h-10 w-full justify-start gap-2 rounded-sm border-border/60 bg-background/25 font-mono text-[12px] hover:bg-background/60"
              onClick={() => setQuickStartOpen(true)}
            >
              <Zap className="h-4 w-4" />
              <span className="truncate">{t("sidebar.quickStart")}</span>
            </Button>
          </motion.div>
          <Button
            variant="outline"
            size="icon-sm"
            className="h-10 w-10 rounded-sm border-border/60 bg-background/25"
            onClick={() => setQuickStartOpen(true)}
            aria-label={t("sidebar.quickStart")}
            title={t("sidebar.quickStart")}
          >
            <Zap className="h-4 w-4" />
          </Button>
        </div>

        <div className="rounded-sm border border-border/60 bg-background/25 p-3 font-mono text-[10px] text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Route B · 云端多会话</span>
            <span className="inline-flex items-center gap-1">
              <Cpu className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("sidebar.edgeUi")}</span>
            </span>
          </div>
        </div>
      </footer>

      <FeatureManifestDialog open={manifestOpen} onOpenChange={setManifestOpen} />

      {quickStartOpen ? (
        <div className="fixed inset-0 z-[65]">
          <button
            type="button"
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            aria-label="close"
            onClick={() => setQuickStartOpen(false)}
          />
          <div className="relative mx-auto flex min-h-dvh max-w-[920px] items-center px-4 py-10">
            <div
              className="w-full overflow-hidden rounded-2xl border border-border/60 bg-background/85 shadow-[0_0_0_1px_oklch(0.488_0.243_264.376/0.18),0_30px_120px_oklch(0_0_0/0.55)]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="sk-quickstart-title"
            >
              <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/30">
                    <Zap className="h-5 w-5 text-sidebar-primary" />
                  </span>
                  <div className="min-w-0">
                    <div id="sk-quickstart-title" className="text-sm font-semibold tracking-wide">
                      {t("setup.modal.title")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{t("setup.modal.subtitle")}</div>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="icon-sm"
                  className="border-border/60 bg-background/30"
                  onClick={() => setQuickStartOpen(false)}
                  aria-label="close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="max-h-[78vh] overflow-auto sk-scrollbar px-5 py-4">
                <SetupGuide compact />
                <div className="mt-4 flex justify-end gap-2 border-t border-border/60 pt-4">
                  <Button variant="outline" className="border-border/60 bg-background/30" onClick={() => setQuickStartOpen(false)}>
                    {t("setup.modal.close")}
                  </Button>
                  <Button
                    onClick={() => {
                      goPanel("settings")
                      setQuickStartOpen(false)
                    }}
                  >
                    {t("setup.modal.gotoSettings")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})
