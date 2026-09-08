import { assertEncryptionSecretForProduction } from "@/lib/crypto-server"
import { ensureLogsDir } from "@/lib/logs.node"
import { recoverExpiredDagLeases } from "@/lib/agent/dag-persistence"

export async function register() {
  assertEncryptionSecretForProduction()
  ensureLogsDir()
  await recoverExpiredDagLeases().catch((error) => {
    console.error("[dag lease recovery]", error)
  })
}
