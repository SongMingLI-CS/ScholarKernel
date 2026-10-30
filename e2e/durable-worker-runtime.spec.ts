import { spawn, type ChildProcess } from "node:child_process"
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

test("durable HTTP Jobs complete in the separate Worker with a local Mock OpenAI-compatible endpoint", async ({ request }) => {
  test.skip(process.env.AGENT_DURABLE_JOBS !== "1", "requires the isolated durable-job database")
  let modelCalls = 0
  let reviewerCalls = 0
  let workerOutput = ""
  let workerError = ""
  let worker: ChildProcess | undefined
  let releaseBlockedModel: (() => void) | undefined
  let signalBlockedModelStarted: (() => void) | undefined
  const blockedModelStarted = new Promise<void>(resolve => { signalBlockedModelStarted = resolve })
  const modelServer = createServer(async (incoming, outgoing) => {
    if (incoming.url !== "/v1/chat/completions" || incoming.method !== "POST") {
      outgoing.writeHead(404).end("Not found")
      return
    }
    modelCalls++
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: string; stream?: boolean }
    const requestText = JSON.stringify(body)
    if (body.stream && requestText.includes("CANCEL_FIXTURE")) {
      const id = `chatcmpl-${modelCalls}`
      outgoing.writeHead(200, { "content-type": "text/event-stream" })
      outgoing.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model: body.model ?? "fixture-model", choices: [{ index: 0, delta: { role: "assistant", content: "取消前的合成流" }, finish_reason: null }] })}\n\n`)
      signalBlockedModelStarted?.()
      await new Promise<void>(resolve => {
        releaseBlockedModel = resolve
        outgoing.once("close", resolve)
      })
      if (!outgoing.destroyed) outgoing.end("data: [DONE]\n\n")
      return
    }
    const isPeerReviewTask = requestText.includes("PEER_REVIEW_FIXTURE")
    const content = requestText.includes("任务编排器") && isPeerReviewTask
      ? JSON.stringify([{ id: "review-placeholder", type: "reasoning", provider: "cloud", status: "pending", title: "审阅合成摘要", input: { query: "合成摘要" } }])
      : requestText.includes("任务编排器")
        ? JSON.stringify([
          { id: "reasoning-evidence-fixture", type: "reasoning", provider: "cloud", status: "pending", title: "整理合成研究证据", input: { query: "合成研究证据" } },
          { id: "reasoning-synthesis-fixture", type: "reasoning", provider: "cloud", status: "pending", title: "综合合成研究结论", input: { query: "综合合成研究结论" } },
        ])
        : requestText.includes("DIRECT_CHAT 模式")
          ? "由本地模拟模型完成的服务端回复。"
          : "由本地模拟模型完成的推理节点结果。"
    if (body.stream && /Reviewer #(?:1|2)（/.test(requestText) && !/激辩/.test(requestText)) reviewerCalls++
    const model = body.model ?? "fixture-model"
    if (body.stream) {
      const id = `chatcmpl-${modelCalls}`
      outgoing.writeHead(200, { "content-type": "text/event-stream" })
      outgoing.end([
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}`,
        `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } })}`,
        "data: [DONE]",
        "",
      ].join("\n\n") + "\n\n")
      return
    }
    outgoing.writeHead(200, { "content-type": "application/json" })
    outgoing.end(JSON.stringify({
      id: `chatcmpl-${modelCalls}`,
      object: "chat.completion",
      created: 1,
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 },
    }))
  })

  await new Promise<void>((resolve, reject) => {
    modelServer.once("error", reject)
    modelServer.listen(0, "127.0.0.1", resolve)
  })

  try {
    const address = modelServer.address()
    if (!address || typeof address === "string") throw new Error("Mock model server did not bind a TCP port")
    const baseUrl = `http://127.0.0.1:${address.port}`
    const createResponse = await request.post("/api/agent/jobs", {
      data: {
        executionMode: "durable",
        userInput: "你好",
        provider: { providerId: "openai", model: "fixture-model", baseUrl },
      },
    })
    expect(createResponse.status()).toBe(202)
    const created = await createResponse.json() as { id: string }
    expect(created.id).toBeTruthy()

    const startWorker = () => {
      const workerEnv = { ...process.env, AGENT_DURABLE_JOBS: "1", OPENAI_API_KEY: "local-fixture-key" } as NodeJS.ProcessEnv
      delete workerEnv["AUTH_PASSWORD"]
      delete workerEnv["AUTH_SESSION_SECRET"]
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/agent-worker.ts"], { cwd: process.cwd(), env: workerEnv, stdio: ["ignore", "pipe", "pipe"] })
      worker = child
      child.stdout?.on("data", chunk => { workerOutput += String(chunk) })
      child.stderr?.on("data", chunk => { workerError += String(chunk) })
      return child
    }
    const spawnedWorker = startWorker()

    await expect.poll(async () => {
      if (spawnedWorker.exitCode !== null) throw new Error(`Worker exited early: ${workerError || workerOutput}`)
      const response = await request.get(`/api/agent/jobs/${encodeURIComponent(created.id)}`)
      expect(response.status()).toBe(200)
      const job = await response.json() as { status?: string }
      return job.status
    }, { timeout: 20_000, intervals: [100, 200, 500] }).toBe("completed")

    const jobResponse = await request.get(`/api/agent/jobs/${encodeURIComponent(created.id)}`)
    const job = await jobResponse.json() as { result?: { final?: string }; eventSequence?: number }
    expect(job.result?.final).toBe("由本地模拟模型完成的服务端回复。")
    expect(modelCalls).toBe(1)

    const eventsResponse = await request.get(`/api/agent/jobs/${encodeURIComponent(created.id)}/events`, {
      headers: { "last-event-id": `${created.id}:1` },
    })
    expect(eventsResponse.headers()["content-type"]).toContain("text/event-stream")
    const events = await eventsResponse.text()
    expect(events).toContain(`id: ${created.id}:2`)
    expect(events).toContain('"type":"job_completed"')
    expect(events).toContain("output_delta")
    expect(job.eventSequence).toBeGreaterThan(1)

    const workflowResponse = await request.post("/api/agent/jobs", {
      data: {
        executionMode: "durable",
        userInput: "请分析这段材料的逻辑结构和结论",
        provider: { providerId: "openai", model: "fixture-model", baseUrl },
      },
    })
    expect(workflowResponse.status()).toBe(202)
    const workflowCreated = await workflowResponse.json() as { id: string }
    await expect.poll(async () => {
      const response = await request.get(`/api/agent/jobs/${encodeURIComponent(workflowCreated.id)}`)
      expect(response.status()).toBe(200)
      const workflow = await response.json() as { status?: string }
      return workflow.status
    }, { timeout: 20_000, intervals: [100, 200, 500] }).toBe("completed")

    const workflowStatus = await request.get(`/api/agent/jobs/${encodeURIComponent(workflowCreated.id)}`)
    const workflow = await workflowStatus.json() as {
      result?: { final?: string; nodes?: Array<{ id?: string; type?: string; status?: string }> }
    }
    expect(workflow.result?.final).toContain("由本地模拟模型完成的推理节点结果")
    expect(workflow.result?.nodes).toContainEqual(expect.objectContaining({ id: "reasoning-evidence-fixture", type: "reasoning", status: "done" }))
    expect(workflow.result?.nodes).toContainEqual(expect.objectContaining({ id: "reasoning-synthesis-fixture", type: "reasoning", status: "done" }))
    expect(modelCalls).toBe(4)

    const reviewResponse = await request.post("/api/agent/jobs", {
      data: {
        executionMode: "durable",
        userInput: "请对合成摘要进行模拟审稿 PEER_REVIEW_FIXTURE",
        provider: { providerId: "openai", model: "fixture-model", baseUrl },
      },
    })
    expect(reviewResponse.status()).toBe(202)
    const reviewJob = await reviewResponse.json() as { id: string }
    await expect.poll(async () => {
      const response = await request.get(`/api/agent/jobs/${encodeURIComponent(reviewJob.id)}`)
      const job = await response.json() as { status?: string }
      return job.status
    }, { timeout: 20_000, intervals: [100, 200, 500] }).toBe("waiting_for_input")
    expect(reviewerCalls).toBe(2)

    const interventionStatus = await request.get(`/api/agent/intervention?sessionId=${encodeURIComponent(reviewJob.id)}`)
    expect(await interventionStatus.json()).toMatchObject({ pending: true, nodeId: "peer-r3" })
    const waitingSnapshot = await request.get(`/api/agent/jobs/${encodeURIComponent(reviewJob.id)}`)
    const waitingJob = await waitingSnapshot.json() as { checkpoint?: { peerReview?: { completedStages?: string[] } } }
    expect(waitingJob.checkpoint?.peerReview?.completedStages).toEqual(expect.arrayContaining(["r1", "r2"]))

    const intervention = await request.post("/api/agent/intervention", {
      data: { jobId: reviewJob.id, nodeId: "peer-r3", action: "approve" },
    })
    expect(await intervention.json()).toMatchObject({ ok: true, nodeId: "peer-r3", duplicate: false })
    const duplicateIntervention = await request.post("/api/agent/intervention", {
      data: { jobId: reviewJob.id, nodeId: "peer-r3", action: "approve" },
    })
    expect(await duplicateIntervention.json()).toMatchObject({ ok: true, nodeId: "peer-r3", duplicate: true })
    await expect.poll(async () => {
      const response = await request.get(`/api/agent/jobs/${encodeURIComponent(reviewJob.id)}`)
      const job = await response.json() as { status?: string }
      return job.status
    }, { timeout: 20_000, intervals: [100, 200, 500] }).toBe("completed")
    expect(reviewerCalls).toBe(2)

    const cancelResponse = await request.post("/api/agent/jobs", {
      data: {
        executionMode: "durable",
        userInput: "你好 CANCEL_FIXTURE",
        provider: { providerId: "openai", model: "fixture-model", baseUrl },
      },
    })
    expect(cancelResponse.status()).toBe(202)
    const cancelJob = await cancelResponse.json() as { id: string }
    await blockedModelStarted
    const cancellation = await request.post(`/api/agent/jobs/${encodeURIComponent(cancelJob.id)}/cancel`)
    expect(await cancellation.json()).toMatchObject({ accepted: true })
    await expect.poll(async () => {
      const response = await request.get(`/api/agent/jobs/${encodeURIComponent(cancelJob.id)}`)
      const job = await response.json() as { status?: string }
      return job.status
    }, { timeout: 15_000, intervals: [100, 200, 500] }).toBe("cancelled")
    releaseBlockedModel?.()

    spawnedWorker.kill("SIGTERM")
    expect(await waitForExit(spawnedWorker, 5_000)).toBe(true)
    worker = undefined
    const restartedWorker = startWorker()
    const restartedResponse = await request.post("/api/agent/jobs", {
      data: {
        executionMode: "durable",
        userInput: "Worker restart fixture",
        provider: { providerId: "openai", model: "fixture-model", baseUrl },
      },
    })
    expect(restartedResponse.status()).toBe(202)
    const restartedJob = await restartedResponse.json() as { id: string }
    await expect.poll(async () => {
      if (restartedWorker.exitCode !== null) throw new Error(`Restarted Worker exited early: ${workerError || workerOutput}`)
      const response = await request.get(`/api/agent/jobs/${encodeURIComponent(restartedJob.id)}`)
      const job = await response.json() as { status?: string }
      return job.status
    }, { timeout: 20_000, intervals: [100, 200, 500] }).toBe("completed")
    expect(modelCalls).toBe(14)
  } finally {
    releaseBlockedModel?.()
    if (worker && worker.exitCode === null && worker.signalCode === null) {
      worker.kill("SIGTERM")
      const stopped = await waitForExit(worker, 5_000)
      if (!stopped) worker.kill("SIGKILL")
      expect(stopped).toBe(true)
    }
    await new Promise<void>(resolve => modelServer.close(() => resolve()))
  }
})
