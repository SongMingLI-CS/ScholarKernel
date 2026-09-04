import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import { resolveUserIdFromRequest } from "@/lib/auth-user"
import { validateProvider, type ProviderId } from "@/lib/ai-gateway"
import { loadRuntimeKeysForUser } from "@/lib/server-runtime-keys"
import { normalizeServerProviderBaseUrl } from "@/lib/provider-base-url"

type ValidateProviderBody = {
  providerId?: unknown
  model?: unknown
  baseUrl?: unknown
  apiKey?: unknown
}

const CLOUD_PROVIDERS = new Set<ProviderId>([
  "openai",
  "deepseek_openai_compat",
  "anthropic",
  "google",
])

function keyForProvider(
  keys: Awaited<ReturnType<typeof loadRuntimeKeysForUser>>,
  providerId: ProviderId
) {
  if (providerId === "openai") return keys.openai
  if (providerId === "deepseek_openai_compat") return keys.deepseek
  if (providerId === "anthropic") return keys.anthropic
  if (providerId === "google") return keys.google
  return undefined
}

export async function POST(req: Request) {
  const userId = await resolveUserIdFromRequest(req)
  if (!userId) return jsonError("Unauthorized", 401)

  const body = await parseJsonBody<ValidateProviderBody>(req)
  if (!body || body.apiKey !== undefined) {
    return jsonError("Invalid body", 400)
  }

  const providerValue = typeof body.providerId === "string" ? body.providerId : ""
  const model = typeof body.model === "string" ? body.model.trim() : ""
  const baseUrl = typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : undefined
  if (!CLOUD_PROVIDERS.has(providerValue as ProviderId) || !model) {
    return jsonError("Invalid body", 400)
  }

  const providerId = providerValue as ProviderId
  const keys = await loadRuntimeKeysForUser(userId)
  const apiKey = keyForProvider(keys, providerId)?.trim()
  if (!apiKey) {
    return jsonOk({ ok: false, latencyMs: 0, kind: "missing_key", status: 401, detail: "MissingApiKey" })
  }

  const result = await validateProvider(providerId, model, {
    baseUrl: normalizeServerProviderBaseUrl(providerId, baseUrl),
    apiKey,
  })
  return jsonOk(result)
}
