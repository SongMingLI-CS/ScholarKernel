import "server-only"

import { decryptFromStorage } from "@/lib/crypto-server"
import { prisma } from "@/lib/prisma"
import type { AgentExecutorDeps } from "@/lib/agent/executor-types"

type ServerRuntimeKeys = NonNullable<AgentExecutorDeps["runtimeKeys"]>

function parseStoredRuntimeKeys(stored: string | null | undefined): ServerRuntimeKeys {
  if (!stored) return {}
  try {
    const parsed = JSON.parse(decryptFromStorage(stored)) as Record<string, unknown>
    const read = (key: keyof ServerRuntimeKeys) =>
      typeof parsed[key] === "string" && parsed[key].trim() ? parsed[key].trim() : undefined
    return {
      openai: read("openai"),
      anthropic: read("anthropic"),
      google: read("google"),
      deepseek: read("deepseek"),
      tavily: read("tavily"),
      serper: read("serper"),
    }
  } catch {
    return {}
  }
}

/** Loads encrypted provider credentials exclusively in the server runtime. */
export async function loadRuntimeKeysForUser(userId: string): Promise<ServerRuntimeKeys> {
  const row = await prisma.userSetting.findUnique({
    where: { userId },
    select: { runtimeKeys: true },
  })
  return parseStoredRuntimeKeys(row?.runtimeKeys)
}
