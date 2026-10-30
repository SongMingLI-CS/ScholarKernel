import "dotenv/config"
import { randomUUID } from "node:crypto"
import { runNextDurableJob } from "../src/lib/agent/job-worker"
import { prisma } from "../src/lib/prisma"
import { logDiagnosticError } from "../src/lib/diagnostics"

const workerId = `worker-${randomUUID()}`
let stopping = false
process.on("SIGTERM", () => { stopping = true })
process.on("SIGINT", () => { stopping = true })
async function main() {
  if (process.env.AGENT_DURABLE_JOBS !== "1") throw new Error("Set AGENT_DURABLE_JOBS=1 before starting the worker")
  while (!stopping) {
    try {
      const worked = await runNextDurableJob(workerId)
      if (!worked) await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      logDiagnosticError("[worker] poll failed", error)
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }
}
void main().catch(error => { logDiagnosticError("[worker] stopped", error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
