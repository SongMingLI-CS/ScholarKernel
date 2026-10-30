import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { expect, test } from "@playwright/test"

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

test("browser refresh reconnects to the same real durable Job", async ({ page, request }) => {
  test.skip(process.env.AGENT_DURABLE_JOBS !== "1" || process.env.NEXT_PUBLIC_AGENT_EXECUTION !== "server", "requires the isolated durable-job database and server execution")
  let modelStarted = false
  let releaseModel: (() => void) | undefined
  let workerOutput = ""
  let workerError = ""
  let worker: ChildProcess | undefined
  let jobId: string | undefined
  let createRequests = 0
  let eventConnections = 0

  const modelServer = createServer(async (incoming, outgoing) => {
    if (incoming.url !== "/api/chat" || incoming.method !== "POST") {
      outgoing.writeHead(404).end("Not found")
      return
    }
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: string }
    outgoing.writeHead(200, { "content-type": "application/x-ndjson" })
    outgoing.write(`${JSON.stringify({
      model: body.model ?? "fixture-model",
      created_at: new Date().toISOString(),
      message: { role: "assistant", content: "刷新前的合成部分输出。" },
      done: false,
    })}\n`)
    modelStarted = true
    await new Promise<void>(resolve => {
      releaseModel = resolve
    })
    outgoing.end(`${JSON.stringify({
      model: body.model ?? "fixture-model",
      created_at: new Date().toISOString(),
      message: { role: "assistant", content: "刷新后的合成完整回答。" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 17,
      eval_count: 9,
    })}\n`)
  })

  await new Promise<void>((resolve, reject) => {
    modelServer.once("error", reject)
    modelServer.listen(0, "127.0.0.1", resolve)
  })

  try {
    const address = modelServer.address()
    if (!address || typeof address === "string") throw new Error("Mock model server did not bind a TCP port")
    const baseUrl = `http://127.0.0.1:${address.port}`
    page.on("request", outgoing => {
      const url = new URL(outgoing.url())
      if (outgoing.method() === "POST" && url.pathname === "/api/agent/jobs") createRequests++
      if (/\/api\/agent\/jobs\/[^/]+\/events(?:\?|$)/.test(url.pathname)) eventConnections++
    })

    const workerEnv = { ...process.env, AGENT_DURABLE_JOBS: "1" } as NodeJS.ProcessEnv
    delete workerEnv["AUTH_PASSWORD"]
    delete workerEnv["AUTH_SESSION_SECRET"]
    const spawnedWorker = spawn(process.execPath, ["--import", "tsx", "scripts/agent-worker.ts"], { cwd: process.cwd(), env: workerEnv, stdio: ["ignore", "pipe", "pipe"] })
    worker = spawnedWorker
    spawnedWorker.stdout?.on("data", chunk => { workerOutput += String(chunk) })
    spawnedWorker.stderr?.on("data", chunk => { workerError += String(chunk) })

    const conversationResponse = await request.post("/api/conversations")
    expect(conversationResponse.status()).toBe(201)
    const conversation = await conversationResponse.json() as { id: string }
    await page.addInitScript(() => localStorage.setItem("sk:onboarding:v1", "done"))
    await page.goto(`/?c=${encodeURIComponent(conversation.id)}`)
    await expect(page.getByPlaceholder(/输入任务|Type a task/)).toBeVisible()

    const createdResponse = await request.post("/api/agent/jobs", {
      data: {
        executionMode: "durable",
        userInput: "你好",
        provider: { providerId: "ollama", model: "fixture-model", baseUrl },
        conversationId: conversation.id,
        assistantMessageId: randomUUID(),
      },
    })
    expect(createdResponse.status()).toBe(202)
    jobId = (await createdResponse.json() as { id: string }).id
    expect(jobId).toBeTruthy()
    await page.reload()

    await expect.poll(async () => {
      if (worker?.exitCode !== null) throw new Error(`Worker exited early: ${workerError || workerOutput}`)
      const response = await request.get(`/api/agent/jobs/${encodeURIComponent(jobId!)}`)
      const snapshot = await response.json() as { status?: string; errorMessage?: string }
      if (snapshot.status === "failed") throw new Error(`Durable Job failed: ${snapshot.errorMessage ?? "unknown error"}`)
      return modelStarted
    }, { timeout: 20_000 }).toBe(true)
    await expect.poll(() => eventConnections, { timeout: 20_000 }).toBeGreaterThan(0)
    await expect(page.getByText("刷新前的合成部分输出")).toBeVisible({ timeout: 20_000 })
    const initialJob = await request.get(`/api/agent/jobs/${encodeURIComponent(jobId!)}`)
    expect((await initialJob.json()).status).toBe("running")

    await page.reload()
    await expect.poll(() => eventConnections, { timeout: 20_000 }).toBeGreaterThan(1)
    releaseModel?.()
    await expect(page.getByText(/刷新后的合成完整回答/)).toBeVisible({ timeout: 20_000 })

    expect(createRequests).toBe(0)
    const finalJob = await request.get(`/api/agent/jobs/${encodeURIComponent(jobId!)}`)
    const snapshot = await finalJob.json() as { status?: string; eventSequence?: number }
    expect(snapshot.status).toBe("completed")
    expect(snapshot.eventSequence).toBeGreaterThan(1)
  } finally {
    releaseModel?.()
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM")
      const stopped = await waitForExit(worker, 5_000)
      if (!stopped) worker.kill("SIGKILL")
      expect(stopped, `Worker did not stop cleanly: ${workerError || workerOutput}`).toBe(true)
    }
    await new Promise<void>(resolve => modelServer.close(() => resolve()))
  }
})
