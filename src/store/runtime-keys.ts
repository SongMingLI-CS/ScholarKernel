import type { ProviderId, RuntimeKeyField, RuntimeKeys } from "@/store/types"

export const EMPTY_RUNTIME_KEYS: RuntimeKeys = {
  openai: "",
  anthropic: "",
  google: "",
  deepseek: "",
  tavily: "",
  serper: "",
}

export const RUNTIME_KEY_FIELDS = Object.keys(EMPTY_RUNTIME_KEYS) as RuntimeKeyField[]

const SESSION_RUNTIME_KEYS = "sk:runtime-keys:session:v3"
const SESSION_RUNTIME_KEYS_LEGACY_V1 = "sk:runtime-keys:session:v1"
const SESSION_RUNTIME_KEYS_LEGACY_V2 = "sk:runtime-keys:session:v2"

export function clearLegacySessionKeys() {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(SESSION_RUNTIME_KEYS)
    window.sessionStorage.removeItem(SESSION_RUNTIME_KEYS_LEGACY_V1)
    window.sessionStorage.removeItem(SESSION_RUNTIME_KEYS_LEGACY_V2)
  } catch {
    /* ignore */
  }
}

function trimKey(value: string | undefined | null) {
  return typeof value === "string" ? value.trim() : ""
}

export function isUsableApiKey(value: string | undefined | null): boolean {
  const t = trimKey(value)
  if (!t) return false
  if (t.length < 8) return false
  if (/dummy/i.test(t)) return false
  if (/^(sk|tvly)-test-/i.test(t)) return false
  return true
}

function hasAnyRuntimeKey(keys: RuntimeKeys | null): boolean {
  if (!keys) return false
  return RUNTIME_KEY_FIELDS.some((f) => isUsableApiKey(keys[f]))
}

export function sanitizeRuntimeKeys(raw: RuntimeKeys | null | undefined): RuntimeKeys | null {
  if (!raw) return null
  const out = { ...EMPTY_RUNTIME_KEYS }
  for (const field of RUNTIME_KEY_FIELDS) {
    const v = raw[field]
    out[field] = isUsableApiKey(v) ? trimKey(v) : ""
  }
  return hasAnyRuntimeKey(out) ? out : null
}

export function getRuntimeKeyForProvider(keys: RuntimeKeys | null | undefined, providerId: ProviderId): string {
  if (!keys || providerId === "ollama") return ""
  if (providerId === "openai") return trimKey(keys.openai)
  if (providerId === "deepseek_openai_compat") return trimKey(keys.deepseek)
  if (providerId === "anthropic") return trimKey(keys.anthropic)
  if (providerId === "google") return trimKey(keys.google)
  return ""
}

export function hasRuntimeKeyForProvider(keys: RuntimeKeys | null | undefined, providerId: ProviderId): boolean {
  return isUsableApiKey(getRuntimeKeyForProvider(keys, providerId))
}

export function mergeRuntimeKeysUpdate(
  existing: RuntimeKeys | null | undefined,
  incoming: Partial<RuntimeKeys>
): RuntimeKeys | null {
  const prev = sanitizeRuntimeKeys(existing) ?? { ...EMPTY_RUNTIME_KEYS }
  const out = { ...EMPTY_RUNTIME_KEYS }
  for (const field of RUNTIME_KEY_FIELDS) {
    const next = incoming[field]
    if (isUsableApiKey(next)) {
      out[field] = trimKey(next)
    } else if (isUsableApiKey(prev[field])) {
      out[field] = prev[field]
    } else {
      out[field] = ""
    }
  }
  return hasAnyRuntimeKey(out) ? out : null
}
