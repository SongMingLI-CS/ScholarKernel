import type { ProviderId } from "@/store/types"

const SERVER_UPSTREAMS: Partial<Record<ProviderId, string>> = {
  openai: "https://api.openai.com",
  deepseek_openai_compat: "https://api.deepseek.com",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
}

/** Browser proxy paths cannot be used by server-side provider SDKs. */
export function normalizeServerProviderBaseUrl(providerId: ProviderId, baseUrl?: string): string | undefined {
  const value = baseUrl?.trim().replace(/\/$/, "")
  if (!value) return undefined
  if (value.startsWith("/api/proxy/")) return SERVER_UPSTREAMS[providerId]
  return value
}
