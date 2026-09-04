import { apiFetch } from "@/lib/api-fetch"
import type { ProviderId, ValidateProviderResult } from "@/lib/ai-gateway"

/** Validate a cloud provider without exposing its stored credential to the browser. */
export function validateStoredProvider(
  providerId: Exclude<ProviderId, "ollama">,
  model: string,
  options?: { baseUrl?: string }
): Promise<ValidateProviderResult> {
  return apiFetch<ValidateProviderResult>("/api/providers/validate", {
    method: "POST",
    body: JSON.stringify({ providerId, model, baseUrl: options?.baseUrl }),
  })
}
