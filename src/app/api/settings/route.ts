import {
  EMPTY_RUNTIME_KEYS,
  RUNTIME_KEY_FIELDS,
  sanitizeRuntimeKeys,
  type RuntimeKeys,
  type ThemeMode,
} from "@/store/useAgentStore"
import { resolveUserId } from "@/lib/auth-user"
import { decryptFromStorage, encryptForStorage } from "@/lib/crypto-server"
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-utils"
import type { SettingsPatchBody, SettingsResponse } from "@/lib/db-types"
import { prisma } from "@/lib/prisma"

function mergeRuntimeKeysStored(existing: RuntimeKeys | null, incoming: Partial<RuntimeKeys> | null | undefined): RuntimeKeys | null {
  if (incoming === null) return null
  const base = existing ?? { ...EMPTY_RUNTIME_KEYS }
  const out = { ...EMPTY_RUNTIME_KEYS }
  for (const field of RUNTIME_KEY_FIELDS) {
    const next = incoming?.[field]
    if (next !== undefined) {
      out[field] = typeof next === "string" ? next.trim() : ""
    } else {
      out[field] = base[field] ?? ""
    }
  }
  return sanitizeRuntimeKeys(out)
}

function decryptRuntimeKeys(stored: string | null | undefined): RuntimeKeys | null {
  if (!stored) return null
  try {
    const plaintext = decryptFromStorage(stored)
    const parsed = JSON.parse(plaintext) as Partial<RuntimeKeys>
    return sanitizeRuntimeKeys({ ...EMPTY_RUNTIME_KEYS, ...parsed })
  } catch {
    return null
  }
}

function encryptRuntimeKeys(keys: RuntimeKeys | null): string | null {
  if (!keys) return null
  return encryptForStorage(JSON.stringify(keys))
}

async function getOrCreateSettings() {
  const userId = resolveUserId()
  return prisma.userSetting.upsert({
    where: { userId },
    create: { userId, theme: "dark" },
    update: {},
  })
}

function toSettingsResponse(row: {
  userId: string
  theme: string
  runtimeKeys: string | null
  updatedAt: Date
}): SettingsResponse {
  return {
    userId: row.userId,
    theme: row.theme === "light" ? "light" : "dark",
    runtimeKeys: decryptRuntimeKeys(row.runtimeKeys),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function GET() {
  try {
    const row = await getOrCreateSettings()
    return jsonOk(toSettingsResponse(row))
  } catch (e) {
    console.error("[GET /api/settings]", e)
    return jsonError("Failed to load settings", 500)
  }
}

export async function PATCH(req: Request) {
  const body = await parseJsonBody<SettingsPatchBody>(req)
  if (!body) return jsonError("Invalid body", 400)

  try {
    const current = await getOrCreateSettings()
    const currentKeys = decryptRuntimeKeys(current.runtimeKeys)

    const nextTheme: ThemeMode | undefined =
      body.theme === "light" || body.theme === "dark" ? body.theme : undefined

    let nextKeys = currentKeys
    if (body.runtimeKeys !== undefined) {
      nextKeys = mergeRuntimeKeysStored(currentKeys, body.runtimeKeys)
    }

    const updated = await prisma.userSetting.update({
      where: { userId: current.userId },
      data: {
        ...(nextTheme ? { theme: nextTheme } : {}),
        ...(body.runtimeKeys !== undefined ? { runtimeKeys: encryptRuntimeKeys(nextKeys) } : {}),
      },
    })

    return jsonOk(toSettingsResponse(updated))
  } catch (e) {
    console.error("[PATCH /api/settings]", e)
    return jsonError("Failed to update settings", 500)
  }
}
