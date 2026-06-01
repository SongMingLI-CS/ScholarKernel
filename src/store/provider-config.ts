import type { ProviderId, ProviderConfig, RuntimeKeys, ThemeMode } from "@/store/types"
import { patchSettings } from "@/lib/conversation-api"

export const PROVIDER_DEFAULTS: Record<ProviderId, Required<Pick<ProviderConfig, "model" | "baseUrl">>> = {
  ollama: { model: "llama3.1", baseUrl: "http://localhost:11434" },
  openai: { model: "gpt-4o", baseUrl: "https://api.openai.com/v1" },
  anthropic: { model: "claude-3-5-sonnet-latest", baseUrl: "https://api.anthropic.com" },
  google: { model: "gemini-2.0-flash", baseUrl: "https://generativelanguage.googleapis.com" },
  deepseek_openai_compat: { model: "deepseek-chat", baseUrl: "/api/proxy/deepseek" },
}

export function normalizeProviderModel(providerId: ProviderId, model: string) {
  const m = (model ?? "").trim()
  return m || PROVIDER_DEFAULTS[providerId].model
}

export function resetProviderDefaults(providerId: ProviderId): ProviderConfig {
  const d = PROVIDER_DEFAULTS[providerId]
  return { providerId, model: d.model, baseUrl: d.baseUrl }
}

let settingsSyncTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSettingsSync(patch: { theme?: ThemeMode; runtimeKeys?: Partial<RuntimeKeys> | null }) {
  if (typeof window === "undefined") return
  if (settingsSyncTimer) clearTimeout(settingsSyncTimer)
  settingsSyncTimer = setTimeout(() => {
    settingsSyncTimer = null
    void patchSettings(patch).catch((e) => console.error("[cloud settings sync]", e))
  }, 400)
}
