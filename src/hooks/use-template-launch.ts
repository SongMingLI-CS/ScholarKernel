"use client"

import { useCallback } from "react"

import { useAgentStore } from "@/store/useAgentStore"

/** Bridge template hub launch → chat agent send after optimistic conversation create. */
export function useTemplateLaunch() {
  const launchWithInput = useCallback(async (input: string) => {
    const text = input.trim()
    if (!text) return

    useAgentStore.getState().actions.setActivePanel("chat")

    // Defer to chat panel mount: dispatch custom event consumed by ChatPanelInner.
    window.dispatchEvent(new CustomEvent("sk:template-launch", { detail: { input: text } }))
  }, [])

  return { launchWithInput }
}

export function consumeTemplateLaunchInput(
  handler: (input: string) => void
): () => void {
  const onEvent = (e: Event) => {
    const detail = (e as CustomEvent<{ input?: string }>).detail
    const input = detail?.input?.trim()
    if (input) handler(input)
  }
  window.addEventListener("sk:template-launch", onEvent)
  return () => window.removeEventListener("sk:template-launch", onEvent)
}
