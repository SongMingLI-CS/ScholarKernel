import { assertEncryptionSecretForProduction } from "@/lib/crypto-server"
import { ensureLogsDir } from "@/lib/logs.node"

export function register() {
  assertEncryptionSecretForProduction()
  ensureLogsDir()
}

