export const DEFAULT_LOG_DIR = "logs"

export function ensureLogsDir() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("node:fs") as typeof import("node:fs")
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("node:path") as typeof import("node:path")
    const dir = path.join(process.cwd(), DEFAULT_LOG_DIR)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch {
    // best-effort; never fail startup because of logging
  }
}

