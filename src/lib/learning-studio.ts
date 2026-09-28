/** Browser-side launch metadata; the URL contains only an opaque conversation id. */
export function learningLaunchId(search: string): string | null {
  const params = new URLSearchParams(search)
  const id = params.get("conversation")
  return params.get("learning") === "1" && id && /^learning-[0-9a-f-]{36}$/.test(id) ? id : null
}

export function learningDraftFromMessages(messages: Array<{ metadata?: unknown }>): string | null {
  for (const message of messages) {
    const metadata = message.metadata
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue
    const draft = (metadata as Record<string, unknown>).learningStudioDraft
    if (typeof draft === "string" && draft.trim() && draft.length <= 18000) return draft
  }
  return null
}

export const learningDraftKey = (id: string) => `sk:learning-draft:${id}`
