"use client"

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"
import { type ProviderConfig } from "@/lib/ai-gateway"
import { buildChatHistoryForExecutor } from "@/lib/agent/llm-utils"
import { AgentStreamError, streamAgentRun } from "@/lib/agent-stream-client"
import { applyAgentStreamEvent } from "@/lib/agent-stream-event-handler"
import { mergeEvidenceStatuses } from "@/lib/evidence-status"
import {
  bubbleAfterPlanIntercept,
  connKey,
  patchAssistantOnCrash,
  randomChatId,
} from "@/lib/chat-bubble-utils"
import { findLastRegenerablePair } from "@/lib/conversation-utils"
import { useT } from "@/lib/locales"
import type { LocaleKey } from "@/lib/locales"
import { isAbortError } from "@/lib/run-abort"
import { formatUserFacingErrorMessage } from "@/lib/user-facing-errors"
import { isApiUnauthorizedError, isApiRateLimitError, isHttp429Error } from "@/lib/conversation-api"
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
      const librarySelection = st0.chat.selectedLibraryDocuments
      const documentIds = librarySelection.map((d) => d.id)

      const localOnly = st0.settings.behavior.localOnly
      if (localOnly && provider.providerId !== "ollama") {
        useAgentStore.getState().actions.setActiveProvider(OLLAMA_DEFAULT)
      }
      const sendProvider = localOnly
        ? provider.providerId === "ollama"
          ? provider
          : OLLAMA_DEFAULT
        : provider

      const userMsg = { id: randomChatId(), role: "user" as const, content: sendText }
      const assistantId = randomChatId()
      lastAssistantIdRef.current = assistantId

      // Phase 2: optimistic bubble + topology — zero RTT wait before paint
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
        if (documentIds.length) {
          useAgentStore.getState().actions.clearSelectedLibraryDocuments()
        }
      }
      followBottomRef.current = true
      queueMicrotask(lockToBottomOnce)

      setTopologyOpen(true)
      setStreaming(true)

      const runId = randomChatId()
      activeRunIdRef.current = runId
      const startedAt = performance.now()
      streamAssistantTextLenRef.current = 0
      const st = useAgentStore.getState()
      st.actions.resetWorkflowPlanOutput()
      st.actions.setTopology(buildTopologyForActiveProvider(sendProvider))
      st.actions.patchTopologyNodes({ edge: "running", route: "running", cloud: "idle", sink: "idle" })
      st.actions.setWorkflowNodes([
        {
          id: "sk-init",
          type: "reasoning",
          provider: sendProvider.providerId === "ollama" ? "local" : "cloud",
          status: "running",
          title: "初始化编排",
          logs: ["正在唤醒 Agent 执行器…"],
        },
      ])
      st.actions.startInferenceStream({
        runId,
        assistantMessageId: assistantId,
        startedAt,
        providerId: sendProvider.providerId,
        model: sendProvider.model,
        baseUrl: sendProvider.baseUrl,
      })

      const rollbackOptimisticSend = () => {
        const ids = isRegenerate ? [assistantId] : [userMsg.id, assistantId]
        useAgentStore.getState().actions.rollbackChatMessages(ids)
        useAgentStore.getState().actions.finishInferenceStream({ runId, now: performance.now(), ok: false })
        useAgentStore.getState().actions.setWorkflowNodes([])
        useAgentStore.getState().actions.patchTopologyNodes({ edge: "idle", route: "idle", cloud: "idle", sink: "idle" })
        setStreaming(false)
        activeRunIdRef.current = null
      }

      const k = connKey(sendProvider.providerId, sendProvider.baseUrl, sendProvider.model)
      const conn = connectivity[k]
      if (conn?.health === "offline") {
        rollbackOptimisticSend()
        useAgentStore.getState().actions.pushToast({
          messageKey: "conn.toast.offline.gotoModels",
          detail: typeof conn.errorCode === "number" ? `(${conn.errorCode})` : conn.errorCode ? `(${conn.errorCode})` : "",
          variant: "error",
          ttlMs: 4200,
        })
        useAgentStore.getState().actions.setActivePanel("models")
        return
      }

      const ctrl = new AbortController()
      abortRef.current = ctrl
      userStoppedRef.current = false

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
        useAgentStore.getState().actions.patchTopologyNodes({ edge: "done", route: "running", cloud: "idle", sink: "idle" })
        return streamAgentRun(
          {
            runId,
            userInput: agentUserInput,
            provider: { providerId: p.providerId, model: p.model, baseUrl: p.baseUrl },
            documentIds,
            chatHistory: buildChatHistoryForExecutor(useAgentStore.getState().chat.messages),
            inference: useAgentStore.getState().settings.inference,
            localOnly: localOnly || undefined,
            planRetryMessage: planOpts?.planRetryMessage,
          },
          {
            signal: ctrl.signal,
            onEvent: (event) => {
              const store = useAgentStore.getState()
              applyAgentStreamEvent(event, {
                onHello: () =>
                  store.actions.patchTopologyNodes({ edge: "done", route: "done", cloud: "running", sink: "idle" }),
                onPlan: (nodes) => {
                  setTopologyOpen(true)
                  store.actions.setWorkflowNodes(
                    nodes.map((node) => ({ ...node, title: node.title ?? node.type, logs: node.logs ?? [] }))
                  )
                },
                onNode: (nodeId, patch) => {
                  const cur = store.workflow.nodes.find((node) => node.id === nodeId)
                  store.actions.patchWorkflowNode(nodeId, {
                    status: patch.status ?? cur?.status ?? "pending",
                    output: patch.output,
                    metadata: patch.metadata,
                    error: patch.error,
                  })
                },
                onLog: (nodeId, line) => store.actions.appendNodeLog(nodeId, line),
                onToken: (token) => {
                  const current = store.inference.streaming
                  const aid = current?.assistantMessageId
                  if (!current?.active || current.runId !== runId || !aid) return
                  const displayText = bubbleAfterPlanIntercept(token.text, store.settings.lang)
                  const previousLength = streamAssistantTextLenRef.current
                  const charsDelta = Math.max(0, displayText.length - previousLength)
                  streamAssistantTextLenRef.current = displayText.length
                  store.actions.patchChatMessage(aid, { content: displayText })
                  store.actions.tickInferenceStream({
                    runId,
                    now: performance.now(),
                    charsDelta,
                    firstToken: displayText.length > 0 && current.firstTokenAt == null,
                  })
                },
                onCanvas: (canvas) => store.actions.applyScholarCanvasStream(canvas),
                onSources: (sources) => {
                  const aid = store.inference.streaming?.assistantMessageId
                  if (aid && sources.length) store.actions.patchChatMessage(aid, { sources })
                },
                onEvidence: (statuses) => {
                  const aid = store.inference.streaming?.assistantMessageId
                  if (!aid) return
                  const current = store.chat.messages.find((message) => message.id === aid)
                  store.actions.patchChatMessage(aid, {
                    evidenceStatuses: mergeEvidenceStatuses(current?.evidenceStatuses, statuses),
                  })
                },
                onUsage: (usage) =>
                  store.actions.patchActiveInferenceStream({
                    runId,
                    patch: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
                  }),
                onIntervention: (intervention) => store.actions.setInterventionPending(intervention),
                onError: (streamError) => {
                  if (streamError.code === "PlanHttpError") setPlanHttpTerminalError(streamError.message)
                },
              })
            },
          }
        )
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
        if (isApiRateLimitError(e) || isHttp429Error(e)) {
          rollbackOptimisticSend()
          useAgentStore.getState().actions.pushToast({
            messageKey: "rateLimit.toast",
            variant: "warning",
            ttlMs: 5200,
          })
          return
        }
        ok = false
        console.error("[useChatSend] AgentExecutor.run failed:", e)
        const lang = useAgentStore.getState().settings.lang
        errMsg = formatUserFacingErrorMessage(e, lang)
        if (e instanceof AgentStreamError && /WorkflowPlan|InvalidJSON/i.test(e.code + e.message)) {
          errMsg = formatUserFacingErrorMessage(e, lang)
          setRetryState({ text: rawInput, error: e.message, kind: "replan" })
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
          if (msg.includes("MissingSearchApiKey")) {
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
    [connectivity, followBottomRef, input, lockToBottomOnce, maybeAutoTitle, provider, setInput, setTopologyOpen, streaming]
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
