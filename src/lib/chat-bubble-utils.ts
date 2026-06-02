import { interceptWorkflowPlanInAssistantBubble } from "@/lib/agent-executor"
import { dictionary } from "@/lib/locales"
import { interceptScholarCanvasInAssistantBubble, buildCanvasChatPlaceholder } from "@/lib/scholar-canvas"
import { formatUserFacingErrorMessage } from "@/lib/user-facing-errors"
import type { Lang } from "@/store/types"
import { useAgentStore } from "@/store/useAgentStore"

export function looksLikeWorkflowPlanJson(content: string): boolean {
  const c = content.trim()
  if (c.length < 24) return false
  if (!c.startsWith("{") && !c.startsWith("[")) return false
  if (/"\s*tasks\s*"\s*:\s*\[/.test(c)) return true
  if (/^\s*\[\s*\{/.test(c) && /"(read_file|reasoning|audit|research)"/.test(c)) return true
  return false
}

export function bubbleAfterPlanIntercept(raw: string, lang: Lang): string {
  if (!looksLikeWorkflowPlanJson(raw) && !/^\s*```(?:json)?\s*[\[{]/i.test(raw.trim())) {
    return processScholarCanvasIntercept(raw, lang)
  }
  const p = useAgentStore.getState().providers.active
  const hit = interceptWorkflowPlanInAssistantBubble(raw, {
    providerId: p.providerId,
    model: p.model,
    baseUrl: p.baseUrl,
  })
  if (!hit || hit.planned.length === 0) return processScholarCanvasIntercept(raw, lang)
  const cleaned = hit.cleanedText.trim()
  if (cleaned.length > 0) return processScholarCanvasIntercept(cleaned, lang)
  return dictionary[lang]["chat.workflowRunningPlaceholder"]
}

function processScholarCanvasIntercept(raw: string, lang: Lang): string {
  const hit = interceptScholarCanvasInAssistantBubble(raw)
  if (!hit) return raw

  useAgentStore.getState().actions.applyScholarCanvasStream({
    title: hit.title,
    content: hit.content,
    complete: hit.hasCompleteTag,
  })

  const placeholder = buildCanvasChatPlaceholder(hit.title, lang, !hit.hasCompleteTag)
  const prefix = hit.cleanedText.trim()
  if (prefix.length > 0) return `${prefix}\n\n${placeholder}`
  return placeholder
}

export function patchAssistantOnCrash(assistantId: string, e: unknown) {
  const lang = useAgentStore.getState().settings.lang
  const crash = formatUserFacingErrorMessage(e, lang)
  const cur = useAgentStore.getState().chat.messages.find((m) => m.id === assistantId)?.content?.trim() ?? ""
  useAgentStore.getState().actions.patchChatMessage(assistantId, {
    content: cur ? `${cur}\n\n${crash}` : crash,
  })
}

export function normalizeBaseUrl(baseUrl?: string) {
  if (!baseUrl) return ""
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl
}

export function connKey(providerId: string, baseUrl: string | undefined, model: string) {
  return `${providerId}::${normalizeBaseUrl(baseUrl)}::${(model ?? "").trim()}`
}

export function randomChatId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
