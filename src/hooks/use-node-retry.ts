"use client"

import { useCallback, useRef, useState } from "react"
import { buildChatHistoryForExecutor } from "@/lib/agent/llm-utils"
import { loadAgentExecutor } from "@/lib/agent-executor-loader"
import { snapshotsFromWorkflowNodes } from "@/lib/agent/node-resume"
import type { ActiveProviderId } from "@/lib/agent/planner"
import { bubbleAfterPlanIntercept } from "@/lib/chat-bubble-utils"
import { stripRedactedThinking } from "@/lib/r1-stream-parser"
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
    const runtimeKeys = st.runtimeKeys
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

    const resumeSnapshots = snapshotsFromWorkflowNodes(wfNodes)
    const resumeNodes = wfNodes.map((n) => ({ ...n, logs: n.logs ?? [] }))

    try {
      const { AgentExecutor } = await loadAgentExecutor()
      const executor = new AgentExecutor(
        {
          activeProvider: { providerId: provider.providerId as ActiveProviderId, model: provider.model, baseUrl: provider.baseUrl },
          targetNodeId,
          resumeSnapshots,
          resumeNodes,
          inference: st.settings.inference,
          runtimeKeys: {
            openai: runtimeKeys?.openai,
            anthropic: runtimeKeys?.anthropic,
            google: runtimeKeys?.google,
            deepseek: runtimeKeys?.deepseek,
            tavily: runtimeKeys?.tavily,
            serper: runtimeKeys?.serper,
          },
          getRuntimeKeys: () => useAgentStore.getState().actions.getRuntimeKeys(),
          search: { tavilyApiKey: runtimeKeys?.tavily, serperApiKey: runtimeKeys?.serper },
          sourceApiBase: typeof window !== "undefined" ? window.location.origin : undefined,
          signal: ctrl.signal,
          localOnly: localOnly || undefined,
          getChatHistory: () => buildChatHistoryForExecutor(useAgentStore.getState().chat.messages),
        },
        {
          onNodePatch: (id, patch) => {
            const store = useAgentStore.getState()
            store.actions.patchWorkflowNode(id, {
              status: patch.status,
              output: patch.output,
              metadata: patch.metadata,
              error: patch.error,
            })

            if (assistantId && (patch.status === "done" || patch.status === "running")) {
              const node = store.workflow.nodes.find((n) => n.id === id)
              if (node?.type !== "reasoning") return
              const out = patch.output ?? node.output
              const rec = out && typeof out === "object" ? (out as Record<string, unknown>) : null
              const rawTxt =
                typeof rec?.["finalResponse"] === "string"
                  ? String(rec["finalResponse"])
                  : typeof rec?.["text"] === "string"
                    ? String(rec["text"])
                    : null
              if (rawTxt == null) return
              const lang = store.settings.lang
              store.actions.patchChatMessage(assistantId, {
                content: bubbleAfterPlanIntercept(stripRedactedThinking(rawTxt), lang),
              })
            }
          },
          onNodeLog: (id, line) => useAgentStore.getState().actions.appendNodeLog(id, line),
          onProgress: (payload) => useAgentStore.getState().actions.applyNodeProgress(payload),
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
          onResearchResultsSynced: ({ sources }) => {
            if (!assistantId || !sources.length) return
            useAgentStore.getState().actions.patchChatMessage(assistantId, { sources })
          },
        }
      )

      const { final, sources } = await executor.run(userInput, { targetNodeId, resumeNodes })

      if (assistantId) {
        const lang = useAgentStore.getState().settings.lang
        useAgentStore.getState().actions.patchChatMessage(assistantId, {
          content: bubbleAfterPlanIntercept(final, lang),
          sources,
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
