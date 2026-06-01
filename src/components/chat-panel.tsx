"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState, Component, type ErrorInfo, type ReactNode } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { ArrowUp, Bolt, Check, Copy, Download, Radio, Square } from "lucide-react"

import { AcademicMarkdown, safeMarkdownContent } from "@/components/academic-markdown"
import { TopologyView } from "@/components/topology-view"
import { Button } from "@/components/ui/button"
import { type ProviderConfig } from "@/lib/ai-gateway"
import {
  copyTextToClipboard,
  downloadTextFile,
  formatConversationAsMarkdown,
  sanitizeExportFilename,
} from "@/lib/conversation-utils"
import { AgentExecutor, buildChatHistoryForExecutor, interceptWorkflowPlanInAssistantBubble, WorkflowPlanParseError } from "@/lib/agent-executor"
import type { ActiveProviderId } from "@/lib/agent-executor"
import { dictionary, useT } from "@/lib/locales"
import { isLikelyCorsBlocked } from "@/lib/network-errors"
import { cn } from "@/lib/utils"
import { buildTopologyForActiveProvider } from "@/store/useAgentStore"
import { useAgentStore, type Lang } from "@/store/useAgentStore"
import type { LocaleKey } from "@/lib/locales"

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function crashBubbleMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "UnknownError")
  return `🚨 系统崩溃拦截: ${msg}`
}

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

function patchAssistantOnCrash(assistantId: string, e: unknown) {
  const crash = crashBubbleMessage(e)
  const cur = useAgentStore.getState().chat.messages.find((m) => m.id === assistantId)?.content?.trim() ?? ""
  useAgentStore.getState().actions.patchChatMessage(assistantId, {
    content: cur ? `${cur}\n\n${crash}` : crash,
  })
}

function normalizeBaseUrl(baseUrl?: string) {
  if (!baseUrl) return ""
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

function connKey(providerId: string, baseUrl: string | undefined, model: string) {
  return `${providerId}::${normalizeBaseUrl(baseUrl)}::${(model ?? "").trim()}`
}

/** 识别误入对话区的「任务规划」JSON，避免以 Markdown 正文渲染导致体验与执行流异常。 */
function bubbleAfterPlanIntercept(raw: string, lang: Lang): string {
  if (!looksLikeWorkflowPlanJson(raw) && !/^\s*```(?:json)?\s*[\[{]/i.test(raw.trim())) {
    return raw
  }
  const p = useAgentStore.getState().providers.active
  const hit = interceptWorkflowPlanInAssistantBubble(raw, {
    providerId: p.providerId,
    model: p.model,
    baseUrl: p.baseUrl,
  })
  if (!hit || hit.planned.length === 0) return raw
  const cleaned = hit.cleanedText.trim()
  if (cleaned.length > 0) return cleaned
  return dictionary[lang]["chat.workflowRunningPlaceholder"]
}

function looksLikeWorkflowPlanJson(content: string): boolean {
  const c = content.trim()
  if (c.length < 24) return false
  if (!c.startsWith("{") && !c.startsWith("[")) return false
  if (/"\s*tasks\s*"\s*:\s*\[/.test(c)) return true
  if (/^\s*\[\s*\{/.test(c) && /"(read_file|reasoning|audit|research)"/.test(c)) return true
  return false
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
  const runtimeKeys = useAgentStore((s) => s.runtimeKeys)
  const connectivity = useAgentStore((s) => s.connectivity)
  const streamMetrics = useAgentStore((s) => s.inference.streaming)
  const wfNodes = useAgentStore((s) => s.workflow.nodes)
  const wfIsPlannerOutput = useAgentStore((s) => s.workflow.isPlannerOutput)
  const wfVersion = useAgentStore((s) => s.workflow.version)
  const activeNodeId = useAgentStore((s) => s.workflow.activeNodeId)
  const showThinkingDefault = useAgentStore((s) => s.settings.ui.showThinking)
  const chatMessages = useAgentStore((s) => s.chat.messages)
  const currentConversationId = useAgentStore((s) => s.conversations.currentId)
  const conversationLoading = useAgentStore((s) => s.conversations.loading)
  const pushToast = useAgentStore((s) => s.actions.pushToast)
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  const [topologyOpen, setTopologyOpen] = useState(false)
  const [retryState, setRetryState] = useState<null | { text: string; error: string; kind?: "replan" }>(null)
  const [traceOpen, setTraceOpen] = useState<boolean>(showThinkingDefault)
  /** 规划阶段 HTTP 错误：在「实时思考过程」终端用红色展示 */
  const [planHttpTerminalError, setPlanHttpTerminalError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null)
  const followBottomRef = useRef(true)
  const scrollRafRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const metricsTimerRef = useRef<number | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)
  /** 用于流式 token 的字符增量统计（避免 tickInferenceStream 一直传 charsDelta: 0） */
  const streamAssistantTextLenRef = useRef(0)
  /** 仅传给 AgentExecutor.plan()，不写入 chat.messages */
  const planRetryMessageRef = useRef<string | undefined>(undefined)
  const activeRunIdRef = useRef<string | null>(null)

  const notifyCopied = useCallback(() => {
    pushToast({ messageKey: "chat.copy.done", variant: "success", ttlMs: 1800 })
  }, [pushToast])

  const stopGeneration = useCallback(() => {
    if (!streaming) return
    abortRef.current?.abort()
    abortRef.current = null

    if (metricsTimerRef.current != null) {
      window.clearInterval(metricsTimerRef.current)
      metricsTimerRef.current = null
    }

    const st = useAgentStore.getState()
    const runId = activeRunIdRef.current ?? st.inference.streaming?.runId
    if (runId) {
      st.actions.finishInferenceStream({ runId, now: performance.now(), ok: true })
      st.actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
    }

    const aid = lastAssistantIdRef.current
    if (aid) {
      const cur = st.chat.messages.find((m) => m.id === aid)?.content?.trim() ?? ""
      if (!cur) {
        st.actions.patchChatMessage(aid, { content: t("chat.stopped" as LocaleKey) })
      }
    }

    activeRunIdRef.current = null
    setStreaming(false)
    pushToast({ messageKey: "chat.stop.done", variant: "success", ttlMs: 2400 })
  }, [pushToast, streaming, t])

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

  const onSend = useCallback(async () => {
    const rawInput = input.trim()
    if (!rawInput) return
    if (streaming) return
    setRetryState(null)
    setPlanHttpTerminalError(null)

    const planRetryMessage = planRetryMessageRef.current
    planRetryMessageRef.current = undefined

    const sendText = rawInput

    const effectiveKeys = runtimeKeys
    const needKey = provider.providerId !== "ollama"
    if (needKey && !useAgentStore.getState().actions.hasRuntimeKeyForProvider(provider.providerId)) {
      useAgentStore.getState().actions.pushToast({ messageKey: "gateway.toast.missingKey", variant: "error", ttlMs: 5200 })
      useAgentStore.getState().actions.setActivePanel("keys")
      return
    }

    // 连通性拦截：如果最近一次拨测为 Offline，则阻止发送并提示。
    const k = connKey(provider.providerId, provider.baseUrl, provider.model)
    const conn = connectivity[k]
    if (conn?.health === "offline") {
      useAgentStore.getState().actions.pushToast({
        messageKey: "conn.toast.offline.gotoModels",
        detail: typeof conn.errorCode === "number" ? `(${conn.errorCode})` : conn.errorCode ? `(${conn.errorCode})` : "",
        variant: "error",
        ttlMs: 4200,
      })
      useAgentStore.getState().actions.setActivePanel("models")
      return
    }

    const userMsg = { id: randomId(), role: "user" as const, content: sendText }
    const assistantId = randomId()
    lastAssistantIdRef.current = assistantId
    useAgentStore.getState().actions.pushChatMessage(userMsg)
    useAgentStore.getState().actions.pushChatMessage({ id: assistantId, role: "assistant", content: "" })
    setInput("")
    followBottomRef.current = true
    queueMicrotask(lockToBottomOnce)

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)

    setTopologyOpen(true)

    const runId = randomId()
    activeRunIdRef.current = runId
    const startedAt = performance.now()
    streamAssistantTextLenRef.current = 0
    const st = useAgentStore.getState()
    st.actions.resetWorkflowPlanOutput()

    st.actions.setTopology(buildTopologyForActiveProvider(provider))
    st.actions.patchTopologyNodes({ edge: "running", route: "running", cloud: "idle", sink: "idle" })

    st.actions.startInferenceStream({
      runId,
      assistantMessageId: assistantId,
      startedAt,
      providerId: provider.providerId,
      model: provider.model,
      baseUrl: provider.baseUrl,
    })

    metricsTimerRef.current = window.setInterval(() => {
      useAgentStore.getState().actions.tickInferenceStream({
        runId,
        now: performance.now(),
        charsDelta: 0,
        firstToken: false,
      })
    }, 50)

    const gatewayProvider: ProviderConfig = {
      providerId: provider.providerId,
      model: provider.model,
      baseUrl: provider.baseUrl,
    }

    let ok = true
    let errMsg: string | undefined

    const runOnce = async (p: ProviderConfig, agentUserInput: string, planOpts?: { planRetryMessage?: string }) => {
      // Agent 工作流模式：先拆解 -> 执行 -> 汇总
      const executor = new AgentExecutor(
        {
          activeProvider: { providerId: p.providerId as ActiveProviderId, model: p.model, baseUrl: p.baseUrl },
          inference: {
            temperature: useAgentStore.getState().settings.inference.temperature,
            maxTokens: useAgentStore.getState().settings.inference.maxTokens,
            contextLimit: useAgentStore.getState().settings.inference.contextLimit,
          },
          runtimeKeys: {
            openai: effectiveKeys?.openai,
            anthropic: effectiveKeys?.anthropic,
            google: effectiveKeys?.google,
            deepseek: effectiveKeys?.deepseek,
            tavily: effectiveKeys?.tavily,
            serper: effectiveKeys?.serper,
          },
          // 显式注入：工具执行时读取最新明文 runtimeKeys
          getRuntimeKeys: () => useAgentStore.getState().actions.getRuntimeKeys(),
          search: {
            tavilyApiKey: runtimeKeys?.tavily,
            serperApiKey: runtimeKeys?.serper,
          },
          sourceApiBase: typeof window !== "undefined" ? window.location.origin : undefined,
          getChatHistory: () =>
            buildChatHistoryForExecutor(useAgentStore.getState().chat.messages),
        },
        {
          onWorkflowPlanned: (nodes) => {
            const store = useAgentStore.getState()
            store.actions.setWorkflowNodes(
              nodes.map((n) => ({
                id: n.id,
                type: n.type,
                provider: n.provider,
                status: n.status,
                title: n.title ?? `${n.type}`,
                logs: [],
                metadata: n.metadata,
              }))
            )
          },
          onNodePatch: (id, patch) => {
            const store = useAgentStore.getState()
            const cur = store.workflow.nodes.find((n) => n.id === id)
            const nextStatus = patch.status ?? cur?.status ?? "pending"
            store.actions.patchWorkflowNode(id, {
              status: nextStatus,
              output: patch.output,
              metadata: patch.metadata,
              error: patch.error,
            })

            // Token-level streaming: bind current reasoning output to last assistant message.
            if (store.inference.streaming?.active && store.inference.streaming.assistantMessageId) {
              const node = store.workflow.nodes.find((n) => n.id === id) ?? cur
              if (node?.type !== "reasoning") return
              const out = patch.output ?? node.output
              const rec = out && typeof out === "object" ? (out as Record<string, unknown>) : null
              const txt = typeof rec?.["text"] === "string" ? String(rec["text"]) : null
              if (txt == null) return
              const lang = store.settings.lang
              const displayTxt = bubbleAfterPlanIntercept(txt, lang)
              const prevLen = streamAssistantTextLenRef.current
              const delta = Math.max(0, displayTxt.length - prevLen)
              streamAssistantTextLenRef.current = displayTxt.length
              store.actions.patchChatMessage(store.inference.streaming.assistantMessageId, { content: displayTxt })
              store.actions.tickInferenceStream({
                runId: store.inference.streaming.runId,
                now: performance.now(),
                charsDelta: delta,
                firstToken: displayTxt.length > 0 && store.inference.streaming.firstTokenAt == null,
              })
            }
          },
          onNodeLog: (id, line) => {
            useAgentStore.getState().actions.appendNodeLog(id, line)
          },
          onPlanHttpError: (message) => {
            setPlanHttpTerminalError(message)
          },
          onDirectChatStart: () => {
            const st = useAgentStore.getState()
            st.actions.patchActiveInferenceStream({ runId, patch: { directChat: true } })
            setTopologyOpen(false)
          },
          onDirectChatStream: (acc) => {
            const st = useAgentStore.getState()
            const cur = st.inference.streaming
            const aid = cur?.assistantMessageId
            if (!cur?.active || cur.runId !== runId || !aid) return
            const lang = st.settings.lang
            const displayTxt = bubbleAfterPlanIntercept(acc, lang)
            const prevLen = streamAssistantTextLenRef.current
            const delta = Math.max(0, displayTxt.length - prevLen)
            streamAssistantTextLenRef.current = displayTxt.length
            st.actions.patchChatMessage(aid, { content: displayTxt })
            st.actions.tickInferenceStream({
              runId,
              now: performance.now(),
              charsDelta: delta,
              firstToken: displayTxt.length > 0 && cur.firstTokenAt == null,
            })
          },
          onStreamFlush: ({ reason }) => {
            if (reason === "pre-reasoning-stream") {
              // research → reasoning 切换：重置打字机指针，避免 delta 假死
              streamAssistantTextLenRef.current = 0
            }
          },
          onResearchResultsSynced: ({ sources }) => {
            const st = useAgentStore.getState()
            const aid = st.inference.streaming?.assistantMessageId
            if (!aid || !sources.length) return
            st.actions.patchChatMessage(aid, { sources })
          },
        }
      )

      // 用 topology 视图表达 “思考与拆解”：
      useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "running", cloud: "idle", sink: "idle" })
      return await executor.run(agentUserInput, planOpts)
    }

    try {
      const { final, sources } = await runOnce(gatewayProvider, sendText, planRetryMessage ? { planRetryMessage } : undefined)
      useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
      const lang = useAgentStore.getState().settings.lang
      const finalForBubble = bubbleAfterPlanIntercept(final, lang)
      useAgentStore.getState().actions.patchChatMessage(assistantId, { content: finalForBubble, sources })
      queueMicrotask(lockToBottomOnce)
    } catch (e) {
      ok = false
      console.error("[ChatPanel] AgentExecutor.run failed:", e)
      const msg = e instanceof Error ? e.message : "StreamFailed"
      errMsg = msg
      if (e instanceof WorkflowPlanParseError) {
        errMsg = e.causeDetail ?? e.message
        setRetryState({ text: rawInput, error: e.causeDetail ?? e.rawContent ?? "", kind: "replan" })
        patchAssistantOnCrash(assistantId, e)
        useAgentStore.getState().actions.setWorkflowNodes([])
        useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
        queueMicrotask(lockToBottomOnce)
      } else {
        const msg = e instanceof Error ? e.message : "StreamFailed"
        errMsg = msg
        if (msg.includes("MissingSearchApiKey") && runtimeKeys != null) {
          useAgentStore.getState().actions.pushToast({
            messageKey: "search.toast.unauthorizedWhenLockOn",
            variant: "error",
            ttlMs: 6200,
          })
        }
        if (/InvalidJSON|InvalidJSON:|ZodError|TaskListSchema|Invalid\\s*JSON/i.test(msg)) {
          setRetryState({ text: rawInput, error: msg })
        }
        const isCloud = provider.providerId !== "ollama"
        // 移除强制降级：改为弹窗询问是否切换本地 Ollama 尝试一次。
        if (isCloud && !msg.includes("MissingApiKey")) {
          const want = typeof window !== "undefined" ? window.confirm("云端请求失败，是否切换到本地 Ollama 尝试？") : false
          if (want) {
            ok = true
            errMsg = undefined
            const next = { providerId: "ollama", model: "llama3.1", baseUrl: "http://localhost:11434" } as const
            useAgentStore.getState().actions.setActiveProvider(next)
            useAgentStore.getState().actions.setTopology(buildTopologyForActiveProvider(next))
            useAgentStore.getState().actions.patchTopologyNodes({ edge: "running", route: "running", cloud: "idle", sink: "idle" })
            try {
              const { final, sources } = await runOnce(next, sendText, planRetryMessage ? { planRetryMessage } : undefined)
              useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
              const lang2 = useAgentStore.getState().settings.lang
              useAgentStore.getState().actions.patchChatMessage(assistantId, {
                content: bubbleAfterPlanIntercept(final, lang2),
                sources,
              })
              queueMicrotask(lockToBottomOnce)
              return
            } catch (e2) {
              ok = false
              console.error("[ChatPanel] Ollama fallback failed:", e2)
              const msg2 = e2 instanceof Error ? e2.message : "StreamFailed"
              errMsg = msg2
              patchAssistantOnCrash(assistantId, e2)
            }
          }
        }

        if (isLikelyCorsBlocked(e)) {
          useAgentStore.getState().actions.openCorsHelp({
            providerId: provider.providerId,
            baseUrl: provider.baseUrl,
            detail: msg,
          })
        }
        useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "error", sink: "error" })
        patchAssistantOnCrash(assistantId, e)
      }
    } finally {
      if (metricsTimerRef.current != null) {
        window.clearInterval(metricsTimerRef.current)
        metricsTimerRef.current = null
      }

      const now = performance.now()
      useAgentStore.getState().actions.finishInferenceStream({ runId, now, ok, error: errMsg })
      if (ok) {
        useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
      }

      setStreaming(false)
      abortRef.current = null
      activeRunIdRef.current = null
    }
  }, [connectivity, input, lockToBottomOnce, provider, runtimeKeys, setTopologyOpen, streaming, t])

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
      if (metricsTimerRef.current != null) window.clearInterval(metricsTimerRef.current)
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
    setStreaming(false)
    setTopologyOpen(false)
    setRetryState(null)
    setPlanHttpTerminalError(null)
    abortRef.current?.abort()
    abortRef.current = null
    activeRunIdRef.current = null
  }, [currentConversationId])

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
              onClick={onExportConversation}
              disabled={chatMessages.filter((m) => m.role !== "system").length === 0}
            >
              <Download className="h-3.5 w-3.5" />
              {t("chat.export")}
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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            }}
          >
            <div className="space-y-3 pb-10">
              {chatMessages.map((m) => {
                const isLiveAssistant = streaming && m.role === "assistant" && m.id === lastAssistantIdRef.current
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
                            <div className="absolute right-2 top-2 z-10">
                              <MessageCopyButton
                                content={displayMessageContent(m.content)}
                                label={t("chat.copy")}
                                onCopied={notifyCopied}
                              />
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

          <div className="shrink-0 border-t border-border/60 bg-background/80 backdrop-blur-md dark:bg-[#0a0a0a]/80">
            <div className="mx-auto flex w-full max-w-[1200px] items-end gap-2 px-0 py-3">
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
                onClick={streaming ? stopGeneration : onSend}
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
