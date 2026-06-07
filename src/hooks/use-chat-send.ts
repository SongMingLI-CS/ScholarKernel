"use client"

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"
import { type ProviderConfig } from "@/lib/ai-gateway"
import {
  buildChatHistoryForExecutor,
} from "@/lib/agent/llm-utils"
import { loadAgentExecutor } from "@/lib/agent-executor-loader"
import {
  WorkflowPlanParseError,
  type ActiveProviderId,
} from "@/lib/agent/planner"
import {
  bubbleAfterPlanIntercept,
  connKey,
  patchAssistantOnCrash,
  randomChatId,
} from "@/lib/chat-bubble-utils"
import { findLastRegenerablePair } from "@/lib/conversation-utils"
import { useT } from "@/lib/locales"
import type { LocaleKey } from "@/lib/locales"
import { isLikelyCorsBlocked } from "@/lib/network-errors"
import { isAbortError } from "@/lib/run-abort"
import { formatUserFacingErrorMessage } from "@/lib/user-facing-errors"
import { isApiUnauthorizedError } from "@/lib/conversation-api"
import { formatReferencesContextBlock } from "@/lib/utils/citation-parser"
import { buildTopologyForActiveProvider, useAgentStore } from "@/store/useAgentStore"

const OLLAMA_DEFAULT = { providerId: "ollama" as const, model: "llama3.1", baseUrl: "http://localhost:11434" }

export type UseChatSendOptions = {
  input: string
  setInput: (v: string) => void
  lockToBottomOnce: () => void
  followBottomRef: MutableRefObject<boolean>
  setTopologyOpen: (v: boolean) => void
  maybeAutoTitle: (userText: string) => void
}

export function useChatSend({
  input,
  setInput,
  lockToBottomOnce,
  followBottomRef,
  setTopologyOpen,
  maybeAutoTitle,
}: UseChatSendOptions) {
  const t = useT()
  const provider = useAgentStore((s) => s.providers.active)
  const runtimeKeys = useAgentStore((s) => s.runtimeKeys)
  const connectivity = useAgentStore((s) => s.connectivity)
  const pushToast = useAgentStore((s) => s.actions.pushToast)
  const setChatMessages = useAgentStore((s) => s.actions.setChatMessages)

  const [streaming, setStreaming] = useState(false)
  const [retryState, setRetryState] = useState<null | { text: string; error: string; kind?: "replan" }>(null)
  const [planHttpTerminalError, setPlanHttpTerminalError] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const metricsTimerRef = useRef<number | null>(null)
  const streamAssistantTextLenRef = useRef(0)
  const planRetryMessageRef = useRef<string | undefined>(undefined)
  const activeRunIdRef = useRef<string | null>(null)
  const userStoppedRef = useRef(false)
  const sendModeRef = useRef<"normal" | "regenerate">("normal")
  const lastAssistantIdRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      if (metricsTimerRef.current != null) window.clearInterval(metricsTimerRef.current)
    }
  }, [])

  const stopGeneration = useCallback(() => {
    if (!streaming) return
    userStoppedRef.current = true
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

  const onSend = useCallback(
    async (textOverride?: string) => {
      const isRegenerate = sendModeRef.current === "regenerate"
      sendModeRef.current = "normal"

      const rawInput = (textOverride ?? input).trim()
      if (!rawInput) return
      if (streaming) return
      setRetryState(null)
      setPlanHttpTerminalError(null)

      const planRetryMessage = planRetryMessageRef.current
      planRetryMessageRef.current = undefined

      const st0 = useAgentStore.getState()
      const citationPrefix = formatReferencesContextBlock(st0.chat.attachedReferences, st0.settings.lang)
      const sendText = citationPrefix ? `${citationPrefix}${rawInput}` : rawInput

      const localOnly = useAgentStore.getState().settings.behavior.localOnly
      if (localOnly && provider.providerId !== "ollama") {
        useAgentStore.getState().actions.setActiveProvider(OLLAMA_DEFAULT)
      }
      const sendProvider = localOnly
        ? provider.providerId === "ollama"
          ? provider
          : OLLAMA_DEFAULT
        : provider

      const effectiveKeys = runtimeKeys
      const needKey = !localOnly && sendProvider.providerId !== "ollama"
      if (needKey && !useAgentStore.getState().actions.hasRuntimeKeyForProvider(sendProvider.providerId)) {
        useAgentStore.getState().actions.pushToast({ messageKey: "gateway.toast.missingKey", variant: "error", ttlMs: 5200 })
        useAgentStore.getState().actions.setActivePanel("keys")
        return
      }

      const k = connKey(sendProvider.providerId, sendProvider.baseUrl, sendProvider.model)
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

      const userMsg = { id: randomChatId(), role: "user" as const, content: sendText }
      const assistantId = randomChatId()
      lastAssistantIdRef.current = assistantId

      if (!isRegenerate) {
        useAgentStore.getState().actions.pushChatMessage(userMsg)
        maybeAutoTitle(sendText)
      }
      useAgentStore.getState().actions.pushChatMessage({ id: assistantId, role: "assistant", content: "" })

      if (!isRegenerate) {
        setInput("")
        if (citationPrefix) {
          useAgentStore.getState().actions.clearAttachedReferences()
        }
      }
      followBottomRef.current = true
      queueMicrotask(lockToBottomOnce)

      const ctrl = new AbortController()
      abortRef.current = ctrl
      userStoppedRef.current = false
      setStreaming(true)

      setTopologyOpen(true)

      const runId = randomChatId()
      activeRunIdRef.current = runId
      const startedAt = performance.now()
      streamAssistantTextLenRef.current = 0
      const st = useAgentStore.getState()
      st.actions.resetWorkflowPlanOutput()

      st.actions.setTopology(buildTopologyForActiveProvider(sendProvider))
      st.actions.patchTopologyNodes({ edge: "running", route: "running", cloud: "idle", sink: "idle" })

      st.actions.startInferenceStream({
        runId,
        assistantMessageId: assistantId,
        startedAt,
        providerId: sendProvider.providerId,
        model: sendProvider.model,
        baseUrl: sendProvider.baseUrl,
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
        providerId: sendProvider.providerId,
        model: sendProvider.model,
        baseUrl: sendProvider.baseUrl,
      }

      let ok = true
      let errMsg: string | undefined

      const runOnce = async (p: ProviderConfig, agentUserInput: string, planOpts?: { planRetryMessage?: string }) => {
        const { AgentExecutor } = await loadAgentExecutor()
        const executor = new AgentExecutor(
          {
            activeProvider: { providerId: p.providerId as ActiveProviderId, model: p.model, baseUrl: p.baseUrl },
            interventionSessionId: runId,
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
            getRuntimeKeys: () => useAgentStore.getState().actions.getRuntimeKeys(),
            search: {
              tavilyApiKey: runtimeKeys?.tavily,
              serperApiKey: runtimeKeys?.serper,
            },
            sourceApiBase: typeof window !== "undefined" ? window.location.origin : undefined,
            signal: ctrl.signal,
            localOnly: localOnly || undefined,
            getChatHistory: () => buildChatHistoryForExecutor(useAgentStore.getState().chat.messages),
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
            onProgress: (payload) => {
              useAgentStore.getState().actions.applyNodeProgress(payload)
            },
            onInterventionPending: (event) => {
              useAgentStore.getState().actions.setInterventionPending({
                sessionId: event.sessionId,
                nodeId: event.nodeId,
                reason: event.reason,
              })
            },
            onWorkflowTopologyPruned: (nodes) => {
              useAgentStore.getState().actions.setWorkflowNodes(
                nodes.map((n) => ({
                  id: n.id,
                  type: n.type,
                  provider: n.provider,
                  status: n.status,
                  title: n.title ?? `${n.type}`,
                  logs: n.logs ?? [],
                  metadata: n.metadata,
                  output: n.output,
                  error: n.error,
                }))
              )
            },
            onPlanHttpError: (message) => {
              setPlanHttpTerminalError(message)
            },
            onDirectChatStart: () => {
              const store = useAgentStore.getState()
              store.actions.patchActiveInferenceStream({ runId, patch: { directChat: true } })
              setTopologyOpen(false)
            },
            onDirectChatStream: (acc) => {
              const store = useAgentStore.getState()
              const cur = store.inference.streaming
              const aid = cur?.assistantMessageId
              if (!cur?.active || cur.runId !== runId || !aid) return
              const lang = store.settings.lang
              const displayTxt = bubbleAfterPlanIntercept(acc, lang)
              const prevLen = streamAssistantTextLenRef.current
              const delta = Math.max(0, displayTxt.length - prevLen)
              streamAssistantTextLenRef.current = displayTxt.length
              store.actions.patchChatMessage(aid, { content: displayTxt })
              store.actions.tickInferenceStream({
                runId,
                now: performance.now(),
                charsDelta: delta,
                firstToken: displayTxt.length > 0 && cur.firstTokenAt == null,
              })
            },
            onStreamFlush: ({ reason }) => {
              if (reason === "pre-reasoning-stream") {
                streamAssistantTextLenRef.current = 0
              }
            },
            onResearchResultsSynced: ({ sources }) => {
              const store = useAgentStore.getState()
              const aid = store.inference.streaming?.assistantMessageId
              if (!aid || !sources.length) return
              store.actions.patchChatMessage(aid, { sources })
            },
          }
        )

        useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "running", cloud: "idle", sink: "idle" })
        return await executor.run(agentUserInput, planOpts)
      }

      try {
        const { final, sources } = await runOnce(gatewayProvider, sendText, planRetryMessage ? { planRetryMessage } : undefined)
        if (userStoppedRef.current || ctrl.signal.aborted) {
          return
        }
        useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
        const lang = useAgentStore.getState().settings.lang
        const finalForBubble = bubbleAfterPlanIntercept(final, lang)
        useAgentStore.getState().actions.patchChatMessage(assistantId, { content: finalForBubble, sources })
        queueMicrotask(lockToBottomOnce)
      } catch (e) {
        if (isAbortError(e) || userStoppedRef.current || ctrl.signal.aborted) {
          return
        }
        ok = false
        console.error("[useChatSend] AgentExecutor.run failed:", e)
        const lang = useAgentStore.getState().settings.lang
        errMsg = formatUserFacingErrorMessage(e, lang)
        if (e instanceof WorkflowPlanParseError) {
          errMsg = formatUserFacingErrorMessage(e, lang)
          setRetryState({ text: rawInput, error: e.causeDetail ?? e.rawContent ?? "", kind: "replan" })
          patchAssistantOnCrash(assistantId, e)
          useAgentStore.getState().actions.setWorkflowNodes([])
          useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
          queueMicrotask(lockToBottomOnce)
        } else {
          const msg = e instanceof Error ? e.message : "StreamFailed"
          errMsg = formatUserFacingErrorMessage(e, lang)
          if (isApiUnauthorizedError(e) || /Unauthorized|HTTP 401/i.test(msg)) {
            useAgentStore.getState().actions.pushToast({
              messageKey: "session.heartbeat.expired",
              variant: "error",
              ttlMs: 6200,
            })
          }
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
          const isCloud = sendProvider.providerId !== "ollama"
          if (isCloud && !msg.includes("MissingApiKey")) {
            const want = typeof window !== "undefined" ? window.confirm("云端请求失败，是否切换到本地 Ollama 尝试？") : false
            if (want) {
              ok = true
              errMsg = undefined
              const next = OLLAMA_DEFAULT
              useAgentStore.getState().actions.setActiveProvider(next)
              useAgentStore.getState().actions.setTopology(buildTopologyForActiveProvider(next))
              useAgentStore.getState().actions.patchTopologyNodes({ edge: "running", route: "running", cloud: "idle", sink: "idle" })
              try {
                const { final, sources } = await runOnce(next, sendText, planRetryMessage ? { planRetryMessage } : undefined)
                if (userStoppedRef.current || ctrl.signal.aborted) {
                  return
                }
                useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
                const lang2 = useAgentStore.getState().settings.lang
                useAgentStore.getState().actions.patchChatMessage(assistantId, {
                  content: bubbleAfterPlanIntercept(final, lang2),
                  sources,
                })
                queueMicrotask(lockToBottomOnce)
                return
              } catch (e2) {
                if (isAbortError(e2) || userStoppedRef.current || ctrl.signal.aborted) {
                  return
                }
                ok = false
                console.error("[useChatSend] Ollama fallback failed:", e2)
                errMsg = formatUserFacingErrorMessage(e2, lang)
                patchAssistantOnCrash(assistantId, e2)
              }
            }
          }

          if (isLikelyCorsBlocked(e)) {
            useAgentStore.getState().actions.openCorsHelp({
              providerId: sendProvider.providerId,
              baseUrl: sendProvider.baseUrl,
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
        useAgentStore.getState().actions.clearInterventionPending()
        if (ok) {
          useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "done", sink: "done" })
        }

        setStreaming(false)
        abortRef.current = null
        activeRunIdRef.current = null
      }
    },
    [connectivity, followBottomRef, input, lockToBottomOnce, maybeAutoTitle, provider, runtimeKeys, setInput, setTopologyOpen, streaming]
  )

  const onRegenerate = useCallback(() => {
    if (streaming) return
    const msgs = useAgentStore.getState().chat.messages
    const pair = findLastRegenerablePair(msgs)
    if (!pair) {
      pushToast({ messageKey: "chat.regenerate.none", variant: "error", ttlMs: 3200 })
      return
    }
    setChatMessages(msgs.slice(0, pair.trimBeforeIndex))
    sendModeRef.current = "regenerate"
    void onSend(pair.userText)
  }, [onSend, pushToast, setChatMessages, streaming])

  return {
    streaming,
    retryState,
    setRetryState,
    planHttpTerminalError,
    onSend,
    onRegenerate,
    stopGeneration,
    planRetryMessageRef,
    lastAssistantIdRef,
  }
}
