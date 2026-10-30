import { claimNextJob, commitWorkerEvent } from "@/lib/agent/durable-jobs"
import { runNextDurableJob } from "@/lib/agent/job-worker"
import { AgentExecutor } from "@/lib/agent-executor"
import { createOwnedDocumentReader } from "@/lib/document-service"
import { prisma } from "@/lib/prisma"

async function main() {
  if (process.env.SCHOLAR_UPGRADE_TEST_DATABASE !== "1" || new URL(process.env.DATABASE_URL!).pathname !== "/scholar_upgrade") throw new Error("IsolatedFixtureDatabaseRequired")
  if (process.argv[2] === "checkpoint") {
    const job = await claimNextJob("process-before-restart")
    if (!job?.leaseOwner) throw new Error("FixtureJobMissing")
    await commitWorkerEvent(job.id, job.leaseOwner, "node_completed", { nodeId: "saved-node" }, {
      phase: "running",
      nodes: [
        { id: "saved-node", type: "read_file", provider: "local", status: "done", input: { documentId: process.env.FIXTURE_DOCUMENT_ID }, output: { text: "Committed before process exit" } },
        { id: "remaining-node", type: "read_file", provider: "local", status: "pending", input: { documentId: process.env.FIXTURE_DOCUMENT_ID } },
      ],
      partialResults: [{ id: "saved-node", ok: true, summary: "saved", output: { text: "Committed before process exit" } }],
    })
  } else {
    let reads = 0
    await runNextDurableJob("process-after-restart", async (input, hooks) => {
      const reader = createOwnedDocumentReader(input.userId)
      const executor = new AgentExecutor({
        activeProvider: input.activeProvider, resumeCheckpoint: input.resumeCheckpoint, flushCheckpoint: input.flushCheckpoint,
        readDocument: async id => { reads++; return reader(id) },
      }, hooks)
      const result = await executor.run(input.userInput)
      if (reads !== 1 || result.nodes[0]?.status !== "done") throw new Error("CompletedNodeWasRepeated")
      return result
    })
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.name : "FixtureError"); process.exitCode = 1 }).finally(() => prisma.$disconnect())
