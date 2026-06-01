export const ONBOARDING_STORAGE_KEY = "sk:onboarding:v1"

export type OnboardingPath = "ollama" | "cloud" | "skip"

export function readOnboardingCompleteFlag(raw: string | null | undefined): boolean {
  return raw === "done"
}

export function isOnboardingCompleteInStorage(raw: string | null | undefined): boolean {
  return readOnboardingCompleteFlag(raw)
}

export function onboardingCompleteValue(): string {
  return "done"
}

export function providerPatchForPath(path: OnboardingPath): {
  providerId: "ollama" | "deepseek_openai_compat"
  model: string
  baseUrl?: string
} | null {
  if (path === "ollama") {
    return { providerId: "ollama", model: "llama3.2", baseUrl: "http://localhost:11434" }
  }
  if (path === "cloud") {
    return { providerId: "deepseek_openai_compat", model: "deepseek-chat", baseUrl: "/api/proxy/deepseek" }
  }
  return null
}
