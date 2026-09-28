"use client"

import { useEffect, useState } from "react"
import { fetchConversation } from "@/lib/conversation-api"
import { learningLaunchId, learningDraftFromMessages, learningDraftKey } from "@/lib/learning-studio"
import { useAgentStore } from "@/store/useAgentStore"

/** Mounted inside LoginGate: no private context is read before authentication. */
export function LearningStudioLaunch() {
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const id = learningLaunchId(window.location.search)
    if (!id) return
    let cancelled = false
    async function openConversation() {
      try {
        await useAgentStore.getState().actions.initializeCloud()
        const detail = await fetchConversation(id!)
        if (cancelled) return
        const draft = learningDraftFromMessages(detail.messages)
        if (draft) sessionStorage.setItem(learningDraftKey(id!), draft)
        await useAgentStore.getState().actions.switchConversation(id!)
        if (cancelled) return
        const metadata = detail.messages.find(message => message.role === "system")?.metadata
        if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
          const model = (metadata as Record<string, unknown>).learningStudioModel
          if (typeof model === "string" && model.length <= 100 && /^[a-zA-Z0-9._:/-]+$/.test(model)) {
            useAgentStore.getState().actions.setActiveProvider({ providerId: "deepseek_openai_compat", model, baseUrl: "https://api.deepseek.com/v1" })
          }
        }
        useAgentStore.getState().actions.setActivePanel("chat")
        window.dispatchEvent(new Event("sk:learning-draft"))
        setError(false)
      } catch { if (!cancelled) setError(true) }
    }
    void openConversation()
    return () => { cancelled = true }
  }, [attempt])
  return error ? <div role="alert" className="fixed right-4 top-4 z-[90] rounded-lg border border-border bg-background p-4 text-sm">无法打开学习对话。<button type="button" className="ml-3 underline" onClick={() => setAttempt(value => value + 1)}>重试</button></div> : null
}
