import { spawn, type ChildProcess } from "node:child_process"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID } from "node:crypto"
import { expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ userId: "" }))
vi.mock("@/lib/auth-user", () => ({
  DEFAULT_USER_ID: "agent-runtime-fixture",
  resolveUserIdFromRequest: async () => session.userId,
}))

const enabled = process.env.SCHOLAR_UPGRADE_TEST_DATABASE === "1"
const databasePath = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid").pathname

async function requestText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

async function relayResponse(response: Response, target: ServerResponse) {
  target.writeHead(response.status, Object.fromEntries(response.headers.entries()))
  if (!response.body) {
    target.end()
    return
  }
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      target.write(value)
    }
  } finally {
    reader.releaseLock()
  }
  target.end()
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off("exit", onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once("exit", onExit)
  })
}

it.skipIf(!enabled)("runs the real durable Worker and HTTP route handlers with a local Mock Ollama", async () => {
  expect(databasePath).toBe("/scholar_upgrade")
  vi.stubEnv("AGENT_DURABLE_JOBS", "1")
  const { prisma } = await import("@/lib/prisma")
  const { DEFAULT_USER_ID } = await import("@/lib/auth-user")
  const { POST: createJob } = await import("@/app/api/agent/jobs/route")
  const { GET: getJob } = await import("@/app/api/agent/jobs/[id]/route")
  const { GET: getEvents } = await import("@/app/api/agent/jobs/[id]/events/route")

  session.userId = DEFAULT_USER_ID
  await prisma.user.createMany({ data: [{ id: DEFAULT_USER_ID, name: "Synthetic runtime fixture" }], skipDuplicates: true })
  const conversation = await prisma.conversation.create({ data: { userId: DEFAULT_USER_ID, title: "Synthetic Worker test" } })
  const assistantMessageId = randomUUID()
  let modelCalls = 0
  let apiPostCalls = 0
  let workerOutput = ""
  let workerError = ""
  let worker: ChildProcess | undefined

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? "/", "http://127.0.0.1")
      if (url.pathname === "/api/chat" && incoming.method === "POST") {
        modelCalls++
        const request = JSON.parse(await requestText(incoming)) as { model?: string }
        outgoing.writeHead(200, { "content-type": "application/x-ndjson" })
        outgoing.end(`${JSON.stringify({
          model: request.model ?? "fixture",
          created_at: new Date().toISOString(),
          message: { role: "assistant", content: "由本地模拟模型完成的服务端回复。" },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 17,
          eval_count: 9,
        })}\n`)
        return
      }

      const requestUrl = `http://${incoming.headers.host ?? "127.0.0.1"}${incoming.url ?? "/"}`
      const headers = new Headers()
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(name, value)
        else if (Array.isArray(value)) headers.set(name, value.join(", "))
      }
      const method = incoming.method ?? "GET"
      const body = method === "GET" || method === "HEAD" ? undefined : await requestText(incoming)
      const request = new Request(requestUrl, { method, headers, ...(body === undefined ? {} : { body }) })
      if (url.pathname === "/api/agent/jobs" && method === "POST") {
        apiPostCalls++
        await relayResponse(await createJob(request), outgoing)
        return
      }
      const jobMatch = url.pathname.match(/^\/api\/agent\/jobs\/([^/]+)$/)
      if (jobMatch && method === "GET") {
        await relayResponse(await getJob(request, { params: Promise.resolve({ id: decodeURIComponent(jobMatch[1]!) }) }), outgoing)
        return
      }
      const eventsMatch = url.pathname.match(/^\/api\/agent\/jobs\/([^/]+)\/events$/)
      if (eventsMatch && method === "GET") {
        await relayResponse(await getEvents(request, { params: Promise.resolve({ id: decodeURIComponent(eventsMatch[1]!) }) }), outgoing)
        return
      }
      outgoing.writeHead(404).end("Not found")
    })().catch(error => {
      if (!outgoing.headersSent) outgoing.writeHead(500, { "content-type": "text/plain" })
      outgoing.end(error instanceof Error ? error.message : "Fixture request failed")
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => resolve())
    })
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Fixture server did not bind a TCP port")
    const baseUrl = `http://127.0.0.1:${address.port}`
    const createdResponse = await fetch(`${baseUrl}/api/agent/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionMode: "durable",
        userInput: "你好",
        provider: { providerId: "ollama", model: "fixture-model", baseUrl },
        conversationId: conversation.id,
        assistantMessageId,
      }),
    })
    expect(createdResponse.status).toBe(202)
    const created = await createdResponse.json() as { id: string }
    expect(created.id).toBeTruthy()

    const childEnv = { ...process.env, AGENT_DURABLE_JOBS: "1" } as NodeJS.ProcessEnv
    delete childEnv["AUTH_PASSWORD"]
    delete childEnv["AUTH_SESSION_SECRET"]
    const spawnedWorker = spawn(process.execPath, ["--import", "tsx", "scripts/agent-worker.ts"], { cwd: process.cwd(), env: childEnv, stdio: ["ignore", "pipe", "pipe"] })
    worker = spawnedWorker
    spawnedWorker.stdout?.on("data", chunk => { workerOutput += String(chunk) })
    spawnedWorker.stderr?.on("data", chunk => { workerError += String(chunk) })

    let observed: { status?: string; result?: { final?: string }; eventSequence?: number } | undefined
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const statusResponse = await fetch(`${baseUrl}/api/agent/jobs/${encodeURIComponent(created.id)}`)
      expect(statusResponse.status).toBe(200)
      const snapshot = await statusResponse.json() as NonNullable<typeof observed>
      observed = snapshot
      if (["completed", "partial", "failed", "cancelled"].includes(snapshot.status ?? "")) break
      if (spawnedWorker.exitCode !== null) throw new Error(`Worker exited early (${spawnedWorker.exitCode}): ${workerError || workerOutput}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    expect(observed?.status).toBe("completed")
    expect(observed?.result?.final).toBe("由本地模拟模型完成的服务端回复。")
    expect(apiPostCalls).toBe(1)
    expect(modelCalls).toBe(1)

    const message = await prisma.message.findUniqueOrThrow({ where: { id: assistantMessageId } })
    expect(message.content).toBe("由本地模拟模型完成的服务端回复。")
    const usage = await prisma.tokenAuditLog.findMany({ where: { jobId: created.id } })
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ agentId: "direct-chat", inputTokens: 17, outputTokens: 9 })

    const eventsResponse = await fetch(`${baseUrl}/api/agent/jobs/${encodeURIComponent(created.id)}/events`, {
      headers: { "last-event-id": `${created.id}:1` },
      signal: AbortSignal.timeout(5_000),
    })
    expect(eventsResponse.headers.get("content-type")).toBe("text/event-stream")
    const events = await eventsResponse.text()
    expect(events).toContain(`id: ${created.id}:2`)
    expect(events).toContain('"type":"job_completed"')
    expect(events).toContain("output_delta")
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM")
      const stopped = await waitForExit(worker, 5_000)
      if (!stopped) {
        worker.kill("SIGKILL")
        expect(stopped).toBe(true)
      }
    }
    await new Promise<void>(resolve => server.close(() => resolve()))
    await prisma.conversation.delete({ where: { id: conversation.id } })
    await prisma.agentJob.deleteMany({ where: { userId: DEFAULT_USER_ID, conversationId: conversation.id } })
    await prisma.$disconnect()
    vi.unstubAllEnvs()
  }
})
