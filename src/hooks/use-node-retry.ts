"use client"

import { useCallback, useRef, useState } from "react"
import { buildChatHistoryForExecutor } from "@/lib/agent/llm-utils"
import { applyAgentStreamEvent } from "@/lib/agent-stream-event-handler"
import { streamAgentRun } from "@/lib/agent-stream-client"
import { bubbleAfterPlanIntercept } from "@/lib/chat-bubble-utils"
import { formatUserFacingErrorMessage } from "@/lib/user-facing-errors"
import { useAgentStore } from "@/store/useAgentStore"

export function useNodeRetry() {
  const [retryingNodeId, setRetryingNodeId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const retryNode = useCallback(async (targetNodeId: string) => {
    const st = useAgentStore.getState()
    const wfNodes = st.workflow.nodes
    if (!wfNodes.length) return
    const target = wfNodes.find((n) => n.id === targetNodeId)
    if (!target || target.status !== "error") return
    if (retryingNodeId) return

    const provider = st.providers.active
    const localOnly = st.settings.behavior.localOnly

    const lastUser = [...st.chat.messages].reverse().find((m) => m.role === "user")
    const userInput = lastUser?.content?.trim()
    if (!userInput) {
      st.actions.pushToast({ messageKey: "topology.retry.noInput", variant: "error", ttlMs: 4200 })
      return
    }

    const assistantId = st.inference.streaming?.assistantMessageId ?? st.chat.messages.filter((m) => m.role === "assistant").at(-1)?.id

    setRetryingNodeId(targetNodeId)
    st.actions.patchWorkflowNode(targetNodeId, { status: "running", error: undefined })
    st.actions.pushToast({ messageKey: "topology.retry.started", variant: "success", ttlMs: 2800 })

    const ctrl = new AbortController()
    abortRef.current = ctrl

    const resumeNodes = wfNodes.map((n) => ({ ...n, logs: n.logs ?? [] }))

    try {
      const result = await streamAgentRun(
        {
          userInput,
          provider,
          targetNodeId,
          resumeNodes,
          inference: st.settings.inference,
          localOnly: localOnly || undefined,
          chatHistory: buildChatHistoryForExecutor(st.chat.messages),
          documentIds: st.chat.selectedLibraryDocuments.map((document) => document.id),
        },
        {
          signal: ctrl.signal,
          onEvent: (event) => {
            const store = useAgentStore.getState()
            applyAgentStreamEvent(event, {
              onPlan: (nodes) =>
                store.actions.setWorkflowNodes(
                  nodes.map((node) => ({ ...node, title: node.title ?? node.type, logs: node.logs ?? [] }))
                ),
              onNode: (id, patch) => {
                const current = store.workflow.nodes.find((node) => node.id === id)
                store.actions.patchWorkflowNode(id, {
                  status: patch.status ?? current?.status ?? "pending",
                  output: patch.output,
                  metadata: patch.metadata,
                  error: patch.error,
                })
              },
              onLog: (id, line) => store.actions.appendNodeLog(id, line),
              onToken: (token) => {
                if (!assistantId) return
                store.actions.patchChatMessage(assistantId, {
                  content: bubbleAfterPlanIntercept(token.text, store.settings.lang),
                })
              },
              onCanvas: (canvas) => store.actions.applyScholarCanvasStream(canvas),
              onSources: (sources) => {
                if (assistantId && sources.length) store.actions.patchChatMessage(assistantId, { sources })
              },
              onIntervention: (intervention) => store.actions.setInterventionPending(intervention),
            })
          },
        }
      )

      if (assistantId) {
        const lang = useAgentStore.getState().settings.lang
        useAgentStore.getState().actions.patchChatMessage(assistantId, {
          content: bubbleAfterPlanIntercept(result.final, lang),
          sources: result.sources,
        })
      }

      useAgentStore.getState().actions.pushToast({ messageKey: "topology.retry.done", variant: "success", ttlMs: 3200 })
    } catch (e) {
      const lang = useAgentStore.getState().settings.lang
      const msg = formatUserFacingErrorMessage(e, lang)
      useAgentStore.getState().actions.patchWorkflowNode(targetNodeId, { status: "error", error: msg })
      useAgentStore.getState().actions.pushToast({
        messageKey: "topology.retry.failed",
        detail: msg.slice(0, 180),
        variant: "error",
        ttlMs: 5200,
      })
    } finally {
      setRetryingNodeId(null)
      abortRef.current = null
    }
  }, [retryingNodeId])

  return { retryNode, retryingNodeId }
}
