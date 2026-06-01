"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, Component, type ErrorInfo, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowDown, ArrowUp, Bolt, Check, Copy, Download, Eraser, Paperclip, Radio, RotateCcw, Square } from "lucide-react"

import { AcademicMarkdown, safeMarkdownContent } from "@/components/academic-markdown"
import { TopologyView } from "@/components/topology-view"
import { Button } from "@/components/ui/button"
import {
  copyTextToClipboard,
  deriveConversationTitle,
  downloadTextFile,
  formatConversationAsMarkdown,
  isDefaultConversationTitle,
  sanitizeExportFilename,
} from "@/lib/conversation-utils"
import { collectSourcesFromMessages, exportSourcesAsBibTeX, exportSourcesAsRIS } from "@/lib/citation-export"
import { formatFileAttachmentBlock, readBrowserFileAsText } from "@/lib/browser-file"
import { connKey, looksLikeWorkflowPlanJson } from "@/lib/chat-bubble-utils"
import { useChatSend } from "@/hooks/use-chat-send"
import { useT } from "@/lib/locales"
import { QUICK_PROMPTS } from "@/lib/quick-prompts"
import { cn } from "@/lib/utils"
import { useAgentStore } from "@/store/useAgentStore"
import type { LocaleKey } from "@/lib/locales"

function displayMessageContent(raw: unknown): string {
  const text = safeMarkdownContent(raw)
  if (!text.trim()) return ""
  // 乱码 / 不可解析 JSON 片段：降级为可读提示，而非白屏
  if (/^[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFD]+$/.test(text.replace(/\s/g, ""))) {
    return "⚠️ 模型返回了不可解析的内容，已自动降级显示。请重试或切换模型。"
  }
  if (text.trim().startsWith("{") && text.includes('"tasks"') && text.length > 400 && !text.includes("\n")) {
    return "⚠️ 检测到未格式化的规划 JSON，已拦截展示。工作流若已启动，请查看拓扑图与思考过程。"
  }
  return text
}

const SourcesFoldout = memo(function SourcesFoldout({
  sources,
  title,
  showText,
  hideText,
}: {
  sources?: Array<{ title: string; url: string; snippet?: string; publishedAt?: string }>
  title: string
  showText: string
  hideText: string
}) {
  const [open, setOpen] = useState(false)
  if (!sources || sources.length === 0) return null
  return (
    <div className="mt-3 rounded-sm border border-border/60 bg-background/25 px-3 py-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sidebar-primary/70" />
          {title}
          <span className="rounded-sm border border-border/50 px-1.5 py-0.5 text-[10px] tabular-nums">{sources.length}</span>
        </span>
        <span className="text-[10px]">{open ? hideText : showText}</span>
      </button>
      {open ? (
        <ol className="mt-2.5 space-y-1.5 border-t border-border/40 pt-2.5">
          {sources.slice(0, 12).map((s, idx) => {
            const sid = (s as unknown as { source_id?: string }).source_id ?? String(idx + 1)
            const yearMatch = s.publishedAt?.match(/\b(19|20)\d{2}\b/)
            const year = yearMatch ? ` (${yearMatch[0]})` : s.publishedAt ? ` (${s.publishedAt})` : ""
            return (
              <li key={`${s.url}-${idx}`} className="text-[12px] leading-snug text-foreground/90">
                <span className="mr-1.5 font-mono text-[11px] text-sidebar-primary/80">[{sid}]</span>
                <a
                  className="text-foreground/95 underline decoration-border/60 underline-offset-2 transition-colors hover:text-sky-300 hover:decoration-sky-400/50"
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.title}
                </a>
                {year ? <span className="text-muted-foreground">{year}</span> : null}
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
})

const MessageCopyButton = memo(function MessageCopyButton({
  content,
  label,
  onCopied,
}: {
  content: string
  label: string
  onCopied: () => void
}) {
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(async () => {
    const text = content.trim()
    if (!text) return
    const ok = await copyTextToClipboard(text)
    if (ok) {
      setCopied(true)
      onCopied()
      window.setTimeout(() => setCopied(false), 1600)
    }
  }, [content, onCopied])

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => void onCopy()}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/50 bg-background/50 text-muted-foreground opacity-0 transition-opacity hover:bg-background/80 hover:text-foreground group-hover:opacity-100"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
})

export const ChatPanel = memo(function ChatPanel() {
  return (
    <ChatPanelErrorBoundary>
      <ChatPanelInner />
    </ChatPanelErrorBoundary>
  )
})

class ChatPanelErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e : new Error(String(e)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ChatPanel] render failed", error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="rounded-sm border border-rose-500/35 bg-rose-500/10 px-4 py-3 font-mono text-[13px] text-rose-100/95">
            对话面板遇到异常，已优雅降级。模型返回了无法解析的数据，请重试或切换模型。
          </div>
          <div className="max-w-md font-mono text-[11px] text-muted-foreground">{this.state.error.message}</div>
          <Button
            type="button"
            variant="outline"
            className="rounded-sm font-mono text-[11px]"
            onClick={() => this.setState({ error: null })}
          >
            重新加载面板
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}

const ChatPanelInner = memo(function ChatPanelInner() {
  const t = useT()
  const provider = useAgentStore((s) => s.providers.active)
  const connectivity = useAgentStore((s) => s.connectivity)
  const streamMetrics = useAgentStore((s) => s.inference.streaming)
  const wfNodes = useAgentStore((s) => s.workflow.nodes)
  const wfIsPlannerOutput = useAgentStore((s) => s.workflow.isPlannerOutput)
  const wfVersion = useAgentStore((s) => s.workflow.version)
  const activeNodeId = useAgentStore((s) => s.workflow.activeNodeId)
  const showThinkingDefault = useAgentStore((s) => s.settings.ui.showThinking)
  const lang = useAgentStore((s) => s.settings.lang)
  const chatMessages = useAgentStore((s) => s.chat.messages)
  const currentConversationId = useAgentStore((s) => s.conversations.currentId)
  const conversationLoading = useAgentStore((s) => s.conversations.loading)
  const pushToast = useAgentStore((s) => s.actions.pushToast)
  const renameConversation = useAgentStore((s) => s.actions.renameConversation)
  const clearCurrentConversation = useAgentStore((s) => s.actions.clearCurrentConversation)
  const [input, setInput] = useState("")
  const [topologyOpen, setTopologyOpen] = useState(false)
  const [traceOpen, setTraceOpen] = useState<boolean>(showThinkingDefault)
  const [showScrollDown, setShowScrollDown] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null)
  const followBottomRef = useRef(true)
  const scrollRafRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const notifyCopied = useCallback(() => {
    pushToast({ messageKey: "chat.copy.done", variant: "success", ttlMs: 1800 })
  }, [pushToast])

  const maybeAutoTitle = useCallback(
    (userText: string) => {
      const st = useAgentStore.getState()
      const convId = st.conversations.currentId
      if (!convId) return
      const conv = st.conversations.items.find((c) => c.id === convId)
      if (!conv || !isDefaultConversationTitle(conv.title)) return
      const userCount = st.chat.messages.filter((m) => m.role === "user").length
      if (userCount !== 1) return
      void renameConversation(convId, deriveConversationTitle(userText))
    },
    [renameConversation]
  )

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) {
      // Avoid scroll jitter during streaming: always lock to final scrollHeight.
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
      return
    }
    bottomAnchorRef.current?.scrollIntoView({ behavior: "auto", block: "end" })
  }, [])

  const lockToBottomOnce = useCallback(() => {
    if (!followBottomRef.current) return
    // Coalesce multiple updates (streaming tokens / logs / layout) into one paint.
    if (scrollRafRef.current != null) window.cancelAnimationFrame(scrollRafRef.current)
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = null
      if (!followBottomRef.current) return
      scrollToBottom()
    })
  }, [scrollToBottom])

  const {
    streaming,
    retryState,
    setRetryState,
    planHttpTerminalError,
    onSend,
    onRegenerate,
    stopGeneration,
    planRetryMessageRef,
  } = useChatSend({
    input,
    setInput,
    lockToBottomOnce,
    followBottomRef,
    setTopologyOpen,
    maybeAutoTitle,
  })

  const onClearChat = useCallback(() => {
    if (streaming) return
    if (chatMessages.filter((m) => m.role !== "system").length === 0) return
    if (typeof window !== "undefined" && !window.confirm(t("chat.clear.confirm"))) return
    void clearCurrentConversation()
  }, [chatMessages, clearCurrentConversation, streaming, t])

  const onExportConversation = useCallback(() => {
    const st = useAgentStore.getState()
    const exportable = st.chat.messages.filter((m) => m.role !== "system" || m.content.trim())
    if (exportable.length === 0) {
      pushToast({ messageKey: "chat.export.empty", variant: "error", ttlMs: 3200 })
      return
    }
    const conv = st.conversations.items.find((c) => c.id === st.conversations.currentId)
    const title = conv?.title ?? "对话"
    const md = formatConversationAsMarkdown(title, exportable)
    downloadTextFile(sanitizeExportFilename(title), md)
    pushToast({ messageKey: "chat.export.done", variant: "success", ttlMs: 2400 })
  }, [pushToast])

  const onExportBibTeX = useCallback(() => {
    const sources = collectSourcesFromMessages(useAgentStore.getState().chat.messages)
    if (!sources.length) {
      pushToast({ messageKey: "chat.export.citations.empty", variant: "error", ttlMs: 3200 })
      return
    }
    const conv = useAgentStore.getState().conversations.items.find((c) => c.id === useAgentStore.getState().conversations.currentId)
    const base = sanitizeExportFilename(conv?.title ?? "references").replace(/\.md$/, "")
    downloadTextFile(`${base}.bib`, exportSourcesAsBibTeX(sources), "application/x-bibtex;charset=utf-8")
    pushToast({ messageKey: "chat.export.citations.done", variant: "success", ttlMs: 2400 })
  }, [pushToast])

  const onExportRIS = useCallback(() => {
    const sources = collectSourcesFromMessages(useAgentStore.getState().chat.messages)
    if (!sources.length) {
      pushToast({ messageKey: "chat.export.citations.empty", variant: "error", ttlMs: 3200 })
      return
    }
    const conv = useAgentStore.getState().conversations.items.find((c) => c.id === useAgentStore.getState().conversations.currentId)
    const base = sanitizeExportFilename(conv?.title ?? "references").replace(/\.md$/, "")
    downloadTextFile(`${base}.ris`, exportSourcesAsRIS(sources), "application/x-research-info-systems;charset=utf-8")
    pushToast({ messageKey: "chat.export.citations.done", variant: "success", ttlMs: 2400 })
  }, [pushToast])

  const onPickFile = useCallback(() => {
    if (streaming) return
    fileInputRef.current?.click()
  }, [streaming])

  const onFileSelected = useCallback(
    async (file: File | null) => {
      if (!file || streaming) return
      try {
        const text = await readBrowserFileAsText(file)
        const block = formatFileAttachmentBlock(file.name, text)
        setInput((prev) => (prev.trim() ? `${block}${prev}` : block))
        pushToast({ messageKey: "chat.upload.done", variant: "success", ttlMs: 2400 })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        pushToast({
          messageKey: "chat.upload.failed",
          detail: msg,
          variant: "error",
          ttlMs: 4200,
        })
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    },
    [pushToast, streaming]
  )

  const lastAssistantId = useMemo(() => {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i]?.role === "assistant") return chatMessages[i]!.id
    }
    return null
  }, [chatMessages])

  useEffect(() => {
    if (wfNodes.length > 0) setTopologyOpen(true)
  }, [wfNodes.length, wfVersion])

  useEffect(() => {
    if (followBottomRef.current) lockToBottomOnce()
  }, [lockToBottomOnce, chatMessages, streamMetrics, wfNodes])

  const hotkeysHint = useMemo(() => {
    const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform)
    return isMac ? t("chat.hotkey.mac") : t("chat.hotkey.win")
  }, [t])

  const charsPerSec = useMemo(() => {
    if (!streamMetrics?.active || streamMetrics.totalMs <= 0) return null
    return Math.round((streamMetrics.chars / streamMetrics.totalMs) * 1000)
  }, [streamMetrics])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) window.cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  const providerName = useMemo(() => {
    const key = `provider.name.${provider.providerId}` as LocaleKey
    const localized = t(key)
    return localized === (key as unknown as string) ? provider.providerId : localized
  }, [provider.providerId, t])

  const liveStatusText = useMemo(() => {
    const running = wfNodes.find((n) => n.status === "running")
    if (!running) return ""
    const lastLog = (running.logs ?? []).slice(-1)[0]
    if (typeof lastLog === "string" && lastLog.trim()) return lastLog.trim()
    if (running.type === "research") return t("agent.status.searching" as LocaleKey)
    if (running.type === "read_file") return t("agent.status.reading" as LocaleKey)
    return t("agent.status.thinking" as LocaleKey)
  }, [t, wfNodes])

  const hasRunningWorkflow = useMemo(() => wfNodes.some((n) => n.status === "running"), [wfNodes])

  const showHeaderLive = Boolean(streaming || streamMetrics?.active || hasRunningWorkflow)

  const liveLogTape = useMemo(() => {
    const running = wfNodes.find((n) => n.status === "running")
    const lines = running?.logs ?? []
    if (!running || lines.length === 0) return ""
    return lines
      .slice(-8)
      .map((s) => String(s).trim())
      .filter(Boolean)
      .join("  ·  ")
  }, [wfNodes])

  const activeNode = useMemo(() => {
    if (!activeNodeId) return null
    return wfNodes.find((n) => n.id === activeNodeId) ?? null
  }, [activeNodeId, wfNodes])

  const activeNodeLogs = useMemo(() => {
    const lines = activeNode?.logs ?? []
    return lines.slice(-24)
  }, [activeNode?.logs])

  useEffect(() => {
    setInput("")
    setTopologyOpen(false)
    setRetryState(null)
  }, [currentConversationId, setRetryState])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (streaming) {
        e.preventDefault()
        stopGeneration()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [stopGeneration, streaming])

  if (conversationLoading && chatMessages.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <div className="font-mono text-[13px] text-muted-foreground">加载对话…</div>
      </div>
    )
  }

  return (
    <div key={currentConversationId ?? "no-conv"} className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur-md dark:bg-[#0a0a0a]/85">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-emerald-400/90" />
              <span className="font-mono text-sm font-semibold tracking-wide text-foreground/95">{t("chat.title")}</span>
              <span className="rounded-sm border border-border/60 bg-muted/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("chat.stream")}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
              {t("chat.provider")} ·{" "}
              <span className="inline-flex items-center gap-2">
                <span
                  className={cn(
                    "sk-conn-dot inline-flex h-2 w-2 rounded-full",
                    (() => {
                      const k = connKey(provider.providerId, provider.baseUrl, provider.model)
                      const c = connectivity[k]
                      if (c?.health === "online") return "bg-emerald-400/90"
                      if (c?.health === "offline") return "bg-rose-400/90"
                      return "bg-muted-foreground/60"
                    })()
                  )}
                />
                <span className="text-muted-foreground/90">{providerName}</span>
              </span>{" "}
              / {provider.model}
            </div>
            {showHeaderLive ? (
              <div className="mt-1 space-y-1">
                {liveStatusText ? (
                  <div className="truncate font-mono text-[11px] text-amber-200/90">[{liveStatusText}]</div>
                ) : null}
                {liveLogTape ? (
                  <div className="relative overflow-hidden rounded-sm border border-emerald-500/20 bg-background/40 px-2 py-1 font-mono text-[10px] text-emerald-200/90">
                    <motion.div
                      key={liveLogTape}
                      initial={{ x: 0, opacity: 0.9 }}
                      animate={{ x: [-4, -220] }}
                      transition={{ duration: 3.2, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
                      className="whitespace-nowrap"
                    >
                      {liveLogTape}
                      <span className="px-6 opacity-60">|</span>
                      {liveLogTape}
                    </motion.div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
              onClick={onClearChat}
              disabled={streaming || chatMessages.filter((m) => m.role !== "system").length === 0}
            >
              <Eraser className="h-3.5 w-3.5" />
              {t("chat.clear")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
              onClick={onRegenerate}
              disabled={streaming || !lastAssistantId}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("chat.regenerate")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
              onClick={onExportConversation}
              disabled={chatMessages.filter((m) => m.role !== "system").length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {t("chat.export")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
              onClick={onExportBibTeX}
              disabled={streaming}
            >
              {t("chat.export.bibtex")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
              onClick={onExportRIS}
              disabled={streaming}
            >
              {t("chat.export.ris")}
            </Button>
            <Button variant="outline" size="sm" className="gap-2 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]">
              <Bolt className="h-3.5 w-3.5" />
              {t("chat.quickMode")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
              onClick={() => setTraceOpen((v) => !v)}
            >
              {traceOpen ? "隐藏思考过程" : "显示思考过程"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
              onClick={() => setTopologyOpen((v) => !v)}
            >
              {topologyOpen ? "隐藏拓扑" : "显示拓扑"}
            </Button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {streamMetrics?.active ? (
          <motion.div
            key="infer-strip"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none sticky top-[57px] z-10 flex justify-center px-4"
          >
            <div className="font-mono text-[11px] tracking-wide text-foreground/90">
              <div className="inline-flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border border-emerald-500/25 bg-background/70 px-4 py-2 shadow-[0_0_0_1px_oklch(0.72_0.19_145/0.12)] backdrop-blur dark:bg-[#0a0a0a]/70">
                <span className="text-muted-foreground">{t("chat.ttft")}</span>
                <span className="text-emerald-300/95">{streamMetrics.ttftMs == null ? "—" : `${streamMetrics.ttftMs}ms`}</span>
                <span className="text-border/50">|</span>
                <span className="text-muted-foreground">{t("chat.total")}</span>
                <span>{streamMetrics.totalMs}ms</span>
                <span className="text-border/50">|</span>
                <span className="text-muted-foreground">{t("chat.chars")}</span>
                <span>{streamMetrics.chars}</span>
                {charsPerSec != null ? (
                  <>
                    <span className="text-border/50">|</span>
                    <span className="text-muted-foreground">τ</span>
                    <span className="text-amber-200/90">{charsPerSec} c/s</span>
                  </>
                ) : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {planHttpTerminalError ? (
        <div className="sticky top-[57px] z-10 mx-auto w-full max-w-[1200px] px-4 pb-2">
          <div className="whitespace-pre-wrap rounded-sm border border-rose-500/40 bg-rose-950/50 px-3 py-2 font-mono text-[11px] leading-snug text-rose-100 backdrop-blur-sm">
            {planHttpTerminalError}
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1200px] gap-4 px-4">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto terminal-scrollbar px-4 py-6"
            aria-label="messages"
            onScroll={() => {
              const el = scrollRef.current
              if (!el) return
              const thresholdPx = 48
              const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
              followBottomRef.current = distanceToBottom <= thresholdPx
              setShowScrollDown(distanceToBottom > 120)
            }}
          >
            <div className="space-y-3 pb-10">
              {chatMessages.map((m) => {
                const isLiveAssistant = streaming && m.role === "assistant" && m.id === lastAssistantId
                return (
                  <motion.div
                    key={m.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                    className={cn(
                      "group relative max-w-[860px] border px-4 py-3 text-sm leading-normal shadow-none",
                      m.role === "user" &&
                        "ml-auto rounded-sm border-sidebar-primary/35 bg-sidebar-primary/[0.08] font-sans",
                      m.role === "assistant" &&
                        cn(
                          "rounded-sm border-border/70 bg-card/35 font-sans",
                          "prose-invert [&_.sk-md-root]:text-[13.5px]",
                          isLiveAssistant && "sk-streaming-bubble border-emerald-500/20"
                        ),
                      m.role === "system" &&
                        "rounded-sm border-border/60 bg-muted/15 font-mono text-[12px] text-muted-foreground"
                    )}
                  >
                    {m.role === "system" ? (
                      <AcademicMarkdown
                        content={m.id === "sys-boot" ? t("chat.boot") : displayMessageContent(m.content)}
                        className="text-[12px]"
                        fallbackPrefix="系统消息渲染失败"
                      />
                    ) : m.role === "user" ? (
                      <>
                        <div className="whitespace-pre-wrap pr-8">{displayMessageContent(m.content)}</div>
                        <div className="absolute right-2 top-2">
                          <MessageCopyButton content={displayMessageContent(m.content)} label={t("chat.copy")} onCopied={notifyCopied} />
                        </div>
                      </>

                    ) : displayMessageContent(m.content).length === 0 && isLiveAssistant && streamMetrics?.directChat ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <span className="inline-block h-3 w-1 animate-pulse bg-sky-400/80" />
                        {t("chat.directChatComposing" as LocaleKey)}
                      </span>
                    ) : displayMessageContent(m.content).length === 0 && isLiveAssistant ? (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                        <span className="inline-block h-3 w-1 animate-pulse bg-emerald-400/80" />
                        {t("chat.awaitingTokens")}
                      </span>
                    ) : (
                      <motion.div
                        animate={isLiveAssistant ? { opacity: [0.88, 1] } : { opacity: 1 }}
                        transition={
                          isLiveAssistant
                            ? { duration: 1.1, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
                            : { duration: 0.2 }
                        }
                      >
                        {isLiveAssistant && streamMetrics?.active && traceOpen ? (
                          <div className="mb-3 rounded-sm border border-emerald-500/20 bg-background/30 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-mono text-[11px] font-semibold tracking-wide text-emerald-200/95">
                                实时思考过程（可解释执行轨迹）
                              </div>
                              <span
                                role="button"
                                tabIndex={0}
                                className="cursor-pointer rounded-sm border border-border/60 bg-background/40 px-2 py-1 font-mono text-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                                onClick={() => setTraceOpen(false)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault()
                                    setTraceOpen(false)
                                  }
                                }}
                              >
                                收起
                              </span>
                            </div>

                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                              <div className="rounded-sm border border-border/50 bg-background/40 p-2">
                                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">active node</div>
                                <div className="mt-1 text-[12px] leading-snug">
                                  {activeNode ? (
                                    <>
                                      <div className="font-mono text-[11px] text-foreground/90">{activeNode.title ?? activeNode.id}</div>
                                      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                        {activeNode.provider}/{activeNode.type} · {activeNode.status}
                                      </div>
                                    </>
                                  ) : (
                                    <div className="font-mono text-[10px] text-muted-foreground">（等待规划/进入节点）</div>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-sm border border-border/50 bg-background/40 p-2">
                                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">workflow</div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {wfNodes.slice(0, 12).map((n) => (
                                    <span
                                      key={n.id}
                                      className={cn(
                                        "rounded-sm border px-1.5 py-0.5 font-mono text-[10px]",
                                        n.id === activeNodeId
                                          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                                          : n.status === "done"
                                            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200/80"
                                            : n.status === "error"
                                              ? "border-rose-500/25 bg-rose-500/10 text-rose-100/90"
                                              : n.status === "running"
                                                ? "border-amber-500/25 bg-amber-500/10 text-amber-100/90"
                                                : "border-border/50 bg-background/30 text-muted-foreground"
                                      )}
                                    >
                                      {n.type}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </div>

                            <div className="mt-2 rounded-sm border border-border/50 bg-background/40 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                  live logs
                                </div>
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {activeNodeLogs.length > 0 ? `${activeNodeLogs.length} lines` : "—"}
                                </div>
                              </div>
                              {planHttpTerminalError ? (
                                <div className="mt-2 whitespace-pre-wrap rounded-sm border border-rose-500/35 bg-rose-500/10 px-2 py-2 font-mono text-[10px] leading-snug text-rose-200">
                                  {planHttpTerminalError}
                                </div>
                              ) : null}
                              {activeNodeLogs.length === 0 ? (
                                <div className="mt-1 font-mono text-[10px] text-muted-foreground">（暂无日志）</div>
                              ) : (
                                <div className="mt-1 max-h-[160px] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-snug text-muted-foreground sk-scrollbar">
                                  {activeNodeLogs.join("\n")}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                        {isLiveAssistant &&
                        streamMetrics?.active &&
                        looksLikeWorkflowPlanJson(displayMessageContent(m.content)) &&
                        (wfIsPlannerOutput ||
                          (Boolean(activeNodeId) && wfNodes.some((n) => n.status === "running"))) ? (
                          <div className="mb-2 rounded-sm border border-amber-500/20 bg-amber-500/10 px-3 py-2 font-mono text-[12px] leading-relaxed text-amber-100/95">
                            {t("chat.workflowRunningPlaceholder" as LocaleKey)}
                          </div>
                        ) : (
                          <AcademicMarkdown
                            content={displayMessageContent(m.content)}
                            fallbackPrefix="回复渲染失败"
                          />
                        )}
                        {m.role === "assistant" ? (
                          <>
                            <div className="absolute right-2 top-2 z-10 flex gap-1">
                              <MessageCopyButton
                                content={displayMessageContent(m.content)}
                                label={t("chat.copy")}
                                onCopied={notifyCopied}
                              />
                              {m.id === lastAssistantId && !streaming ? (
                                <button
                                  type="button"
                                  aria-label={t("chat.regenerate")}
                                  title={t("chat.regenerate")}
                                  onClick={() => onRegenerate()}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/50 bg-background/50 text-muted-foreground opacity-0 transition-opacity hover:bg-background/80 hover:text-foreground group-hover:opacity-100"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                            <SourcesFoldout
                              sources={m.sources}
                              title={t("chat.sources")}
                              showText={t("chat.sources.show")}
                              hideText={t("chat.sources.hide")}
                            />
                          </>
                        ) : null}
                      </motion.div>
                    )}
                  </motion.div>
                )
              })}
              <div ref={bottomAnchorRef} />
            </div>
          </div>

          <AnimatePresence>
            {showScrollDown ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="pointer-events-none absolute bottom-28 right-6 z-10"
              >
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="pointer-events-auto gap-2 rounded-full border-border/60 bg-background/90 font-mono text-[11px] shadow-lg backdrop-blur"
                  onClick={() => {
                    followBottomRef.current = true
                    scrollToBottom()
                    setShowScrollDown(false)
                  }}
                  aria-label={t("chat.scrollToBottom")}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  {t("chat.scrollToBottom")}
                </Button>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="shrink-0 border-t border-border/60 bg-background/80 backdrop-blur-md dark:bg-[#0a0a0a]/80">
            <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 px-0 py-3">
              <div className="flex flex-wrap items-center gap-1.5 px-0.5">
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{t("chat.quickPrompts")}</span>
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={streaming}
                    className="rounded-full border border-border/60 bg-background/40 px-2.5 py-1 font-mono text-[10px] text-foreground/85 transition-colors hover:border-sidebar-primary/40 hover:bg-sidebar-primary/10 disabled:opacity-50"
                    onClick={() => {
                      setInput(p.prompt[lang])
                    }}
                  >
                    {p.label[lang]}
                  </button>
                ))}
              </div>
              <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.bib,.tex,.yaml,.yml,.html,.css"
                className="hidden"
                onChange={(e) => void onFileSelected(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
                onClick={onPickFile}
                disabled={streaming}
                title={t("chat.upload.hint")}
              >
                <Paperclip className="h-4 w-4" />
              </Button>
              <div className="flex-1">
                <div className="rounded-sm border border-border/60 bg-background/40 px-3 py-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number }
                      if (native?.isComposing || native?.keyCode === 229) return

                      // Enter 发送；Shift+Enter 换行。保留 Ctrl/Cmd+Enter 兼容旧习惯。
                      if (e.key === "Enter" && !e.shiftKey) {
                        const isHotkey = e.metaKey || e.ctrlKey
                        const isPlainEnter = !e.metaKey && !e.ctrlKey && !e.altKey
                        if (isHotkey || isPlainEnter) {
                          e.preventDefault()
                          onSend()
                        }
                      }
                    }}
                    placeholder={t("chat.input.placeholder")}
                    className="h-[44px] max-h-[160px] w-full resize-none bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                    <span>{hotkeysHint}</span>
                    <span>{t("chat.noBackend")}</span>
                  </div>
                </div>
              </div>
              {retryState ? (
                <div className="flex flex-col items-end gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
                    onClick={() => {
                      if (retryState.kind === "replan") {
                        planRetryMessageRef.current = t("chat.replanPlanRetryHint" as LocaleKey)
                      }
                      setInput(retryState.text)
                      queueMicrotask(() => onSend())
                    }}
                    disabled={streaming}
                    aria-label={retryState.kind === "replan" ? "replan" : "retry"}
                  >
                    {retryState.kind === "replan" ? t("chat.replan") : "手动重试"}
                  </Button>
                  {retryState.kind === "replan" ? (
                    <div className="max-w-[240px] text-right font-mono text-[10px] text-muted-foreground">{t("chat.planParseHint")}</div>
                  ) : (
                    <div className="max-w-[240px] truncate text-right font-mono text-[10px] text-muted-foreground" title={retryState.error}>
                      规划失败：{retryState.error}
                    </div>
                  )}
                </div>
              ) : null}
              <Button
                onClick={() => (streaming ? stopGeneration() : void onSend())}
                className={cn("h-11 gap-2 rounded-sm font-mono", streaming && "border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25")}
                variant={streaming ? "outline" : "default"}
                disabled={!streaming && !input.trim()}
                aria-label={streaming ? "stop" : "send"}
              >
                {streaming ? (
                  <>
                    {t("chat.stop")}
                    <Square className="h-4 w-4 fill-current" />
                  </>
                ) : (
                  <>
                    {t("chat.send")}
                    <ArrowUp className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
          </div>
        </div>

        <AnimatePresence>
          {topologyOpen ? (
            <motion.aside
              key="topology"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="hidden h-full w-[420px] shrink-0 flex-col overflow-hidden py-6 lg:flex"
            >
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Agent Topology
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-sm border-border/60 bg-background/40 font-mono text-[11px]"
                  onClick={() => setTopologyOpen(false)}
                >
                  收起
                </Button>
              </div>
              <div className="min-h-[500px] flex-1 overflow-hidden">
                <TopologyView key={currentConversationId ?? "topology"} />
              </div>
            </motion.aside>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
})
