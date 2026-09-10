#!/usr/bin/env node

import { randomUUID } from "node:crypto"
import { deflateSync } from "node:zlib"

const shouldRun = process.argv.includes("--run")
const libraryOnly = process.argv.includes("--library-only")

function printPlan() {
  console.log([
    "Full staging release smoke plan (no request sent):",
    "1. Upload a generated large PDF and assert the request returns before async index completion.",
    "2. Poll the async index Job, retrieve marker evidence, and reindex unchanged bytes.",
    "3. Start an Agent run, disconnect its SSE transport, reconnect/refresh from database state, and verify completion without duplicate execution.",
    "4. Perform the documented restart lease scenario and verify recovery after a real application process restart.",
    "5. Start another Agent run and explicitly cancel it, then delete the test document and verify removal.",
  ].join("\n"))
}

function stagingTarget() {
  const raw = process.env.STAGING_BASE_URL?.trim()
  if (!raw) throw new Error("STAGING_BASE_URL is required")
  const base = new URL(raw)
  if (!new Set(["http:", "https:"]).has(base.protocol)) throw new Error("STAGING_BASE_URL must use HTTP(S)")
  const expected = process.env.STAGING_EXPECTED_HOST?.trim()
  if (!expected || base.host !== expected) throw new Error("STAGING_EXPECTED_HOST does not match STAGING_BASE_URL")
  if (process.env.STAGING_CONFIRMATION !== "scholarkernel-staging") throw new Error("STAGING_CONFIRMATION must equal scholarkernel-staging")
  base.pathname = "/"
  base.search = ""
  base.hash = ""
  return base
}

function restartTarget() {
  const raw = process.env.STAGING_RESTART_WEBHOOK_URL?.trim()
  if (!raw) throw new Error("STAGING_RESTART_WEBHOOK_URL is required for a real process restart")
  const target = new URL(raw)
  if (target.protocol !== "https:") throw new Error("STAGING_RESTART_WEBHOOK_URL must use HTTPS")
  const expected = process.env.STAGING_EXPECTED_RESTART_HOST?.trim()
  if (!expected || target.host !== expected) throw new Error("STAGING_EXPECTED_RESTART_HOST does not match STAGING_RESTART_WEBHOOK_URL")
  const token = process.env.STAGING_RESTART_WEBHOOK_TOKEN?.trim()
  if (!token) throw new Error("STAGING_RESTART_WEBHOOK_TOKEN is required")
  return { target, token }
}

function headers(extra = {}) {
  const cookie = process.env.STAGING_AUTH_COOKIE?.trim()
  const protectionBypass = process.env.STAGING_PROTECTION_BYPASS?.trim()
  return {
    ...(cookie ? { cookie } : {}),
    ...(protectionBypass ? { "x-vercel-protection-bypass": protectionBypass } : {}),
    ...extra,
  }
}

function pdfEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")
}

function generateLargePdf(marker, minimumBytes = 1_500_000) {
  const pageCount = 48
  const objects = new Map()
  const pageRefs = []
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>")
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  for (let page = 0; page < pageCount; page += 1) {
    const pageId = 4 + page * 2
    const contentId = pageId + 1
    pageRefs.push(`${pageId} 0 R`)
    objects.set(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`)
    const visible = `BT /F1 11 Tf 54 730 Td (${pdfEscape(marker)} page ${page + 1}) Tj ET\n`
    const stream = deflateSync(Buffer.from(visible)).toString("latin1")
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream, "latin1")} /Filter /FlateDecode >>\nstream\n${stream}\nendstream`)
  }
  objects.set(2, `<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageCount} >>`)
  const paddingId = 4 + pageCount * 2
  const padding = "0".repeat(Math.max(1, Math.floor(minimumBytes)))
  objects.set(paddingId, `<< /Length ${Buffer.byteLength(padding)} >>\nstream\n${padding}\nendstream\n% unreferenced transport padding`)
  let pdf = "%PDF-1.4\n"
  const offsets = [0]
  const maxId = Math.max(...objects.keys())
  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1")
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf, "latin1")
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`
  for (let id = 1; id <= maxId; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, "latin1")
}

async function expectStatus(response, expected, step) {
  if (response.status !== expected) throw new Error(`${step} returned HTTP ${response.status}; expected ${expected}`)
  return response
}

async function pollJob(base, jobId, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await expectStatus(await fetch(new URL(`/api/agent/jobs/${encodeURIComponent(jobId)}`, base), { headers: headers() }), 200, "job poll")
    const job = await response.json()
    if (["done", "error", "cancelled"].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error(`job ${jobId} did not reach a terminal state before timeout`)
}

function parseSseFrames(text) {
  return text.split(/\r?\n\r?\n/).flatMap((frame) => {
    const line = frame.split(/\r?\n/).find((item) => item.startsWith("data:"))
    if (!line) return []
    try { return [JSON.parse(line.slice(5).trim())] } catch { return [] }
  })
}

async function startAndDisconnectAgent(base, input) {
  const response = await expectStatus(await fetch(new URL("/api/agent/stream", base), {
    method: "POST", headers: headers({ "content-type": "application/json", accept: "text/event-stream" }), body: JSON.stringify(input),
  }), 200, "agent start")
  const reader = response.body?.getReader()
  if (!reader) throw new Error("agent stream had no response body")
  const decoder = new TextDecoder()
  let text = ""
  while (!text.includes("\n\n")) {
    const part = await reader.read()
    if (part.done) break
    text += decoder.decode(part.value, { stream: true })
  }
  const hello = parseSseFrames(text).find((event) => event.type === "hello")
  if (!hello?.jobId) throw new Error("agent stream did not emit a job id")
  await reader.cancel()
  return hello.jobId
}

async function reconnectAgent(base, input, jobId) {
  const response = await expectStatus(await fetch(new URL("/api/agent/stream", base), {
    method: "POST", headers: headers({ "content-type": "application/json", accept: "text/event-stream" }),
    body: JSON.stringify({ ...input, jobId }),
  }), 200, "agent reconnect")
  const events = parseSseFrames(await response.text())
  if (!events.some((event) => event.type === "done" && event.jobId === jobId)) throw new Error("reconnected stream did not replay a completed database result")
}

async function triggerRestartAndWait(base, restart) {
  const response = await fetch(restart.target, {
    method: "POST",
    headers: { authorization: `Bearer ${restart.token}`, "content-type": "application/json" },
    body: JSON.stringify({ reason: "scholarkernel-staging-release-smoke" }),
  })
  if (!response.ok) throw new Error(`restart webhook returned HTTP ${response.status}`)
  await new Promise((resolve) => setTimeout(resolve, Number(process.env.STAGING_RESTART_SETTLE_MS || 3_000)))
  const deadline = Date.now() + Number(process.env.STAGING_RESTART_TIMEOUT_MS || 180_000)
  while (Date.now() < deadline) {
    try {
      const health = await fetch(new URL("/api/health", base), { headers: headers(), cache: "no-store" })
      if (health.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error("staging application did not become healthy after the restart trigger")
}

async function runSmoke() {
  const base = stagingTarget()
  let restart
  let providerId
  let model
  if (!libraryOnly) {
    restart = restartTarget()
    providerId = process.env.STAGING_AGENT_PROVIDER_ID?.trim()
    model = process.env.STAGING_AGENT_MODEL?.trim()
    if (!providerId || !model) throw new Error("STAGING_AGENT_PROVIDER_ID and STAGING_AGENT_MODEL are required")
  }
  const marker = `scholarkernel-release-smoke-${randomUUID()}`
  const pdf = generateLargePdf(marker, Number(process.env.STAGING_PDF_MIN_BYTES || 1_500_000))
  const form = new FormData()
  form.append("file", new Blob([pdf], { type: "application/pdf" }), `${marker}.pdf`)
  form.append("title", marker)
  form.append("tags", JSON.stringify(["staging-release-smoke"] ))
  let documentId
  try {
    const uploadStartedAt = Date.now()
    const uploaded = await (await expectStatus(await fetch(new URL("/api/documents", base), { method: "POST", headers: headers(), body: form }), 201, "large PDF upload")).json()
    const uploadMs = Date.now() - uploadStartedAt
    if (!uploaded.id || !uploaded.indexJobId || uploaded.indexStatus !== "pending") throw new Error("upload did not return pending async index metadata")
    if (uploadMs > Number(process.env.STAGING_UPLOAD_MAX_MS || 20_000)) throw new Error(`upload blocked for ${uploadMs}ms before returning`)
    documentId = uploaded.id
    console.log(`large PDF upload: passed (${pdf.length} bytes, ${uploadMs}ms)`)

    const downloaded = await expectStatus(await fetch(new URL(`/api/documents/${documentId}/file`, base), { headers: headers() }), 200, "large PDF download")
    if (!Buffer.from(await downloaded.arrayBuffer()).equals(pdf)) throw new Error("downloaded large PDF bytes differ from upload")
    console.log("large PDF byte-identical download: passed")

    const firstIndex = await pollJob(base, uploaded.indexJobId)
    if (firstIndex.status !== "done") throw new Error(`async index failed with status ${firstIndex.status}`)
    console.log("async index: passed")

    const context = await (await expectStatus(await fetch(new URL("/api/documents/context", base), {
      method: "POST", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ documentIds: [documentId], query: marker }),
    }), 200, "marker retrieval")).json()
    if (!context.context?.includes(marker)) throw new Error("indexed PDF marker was not retrieved")
    console.log("PDF retrieval: passed")

    const reindexed = await (await expectStatus(await fetch(new URL("/api/documents", base), {
      method: "PATCH", headers: headers({ "content-type": "application/json" }), body: JSON.stringify({ id: documentId, reindex: true }),
    }), 200, "reindex")).json()
    const secondIndex = await pollJob(base, reindexed.indexJobId)
    if (secondIndex.status !== "done" || !String(secondIndex.result?.final ?? "").includes("already current")) throw new Error("unchanged PDF reindex was not skipped")
    console.log("reindex unchanged file: passed")

    if (!libraryOnly) {
      const agentInput = {
      userInput: process.env.STAGING_AGENT_USER_INPUT?.trim() || "Compare the selected evidence and return a concise staging verification result.",
      provider: { providerId, model }, documentIds: [documentId],
      }
      const disconnectedJobId = await startAndDisconnectAgent(base, agentInput)
      const afterDisconnect = await (await expectStatus(await fetch(new URL(`/api/agent/jobs/${disconnectedJobId}`, base), { headers: headers() }), 200, "disconnect state")).json()
      if (afterDisconnect.status === "cancelled") throw new Error("SSE disconnect incorrectly cancelled the database job")
      console.log("disconnect: passed")
      await reconnectAgent(base, agentInput, disconnectedJobId)
      await reconnectAgent(base, agentInput, disconnectedJobId)
      console.log("reconnect and refresh replay: passed")

      const restartInput = {
        ...agentInput,
        userInput: `${agentInput.userInput} Perform a deliberately detailed multi-step analysis so a real process restart occurs while work is active.`,
      }
      const restartJobId = await startAndDisconnectAgent(base, restartInput)
      const beforeRestart = await (await expectStatus(await fetch(new URL(`/api/agent/jobs/${restartJobId}`, base), { headers: headers() }), 200, "restart precondition")).json()
      if (!new Set(["pending", "running"]).has(beforeRestart.status)) throw new Error(`restart job became ${beforeRestart.status} before the process restart could be triggered`)
      await triggerRestartAndWait(base, restart)
      const afterRestartResponse = await expectStatus(await fetch(new URL(`/api/agent/jobs/${restartJobId}`, base), { headers: headers() }), 200, "restart state")
      const afterRestart = await afterRestartResponse.json()
      if (afterRestart.status === "running" && afterRestart.leaseExpiresAt) {
        const leaseWaitMs = Math.max(0, new Date(afterRestart.leaseExpiresAt).getTime() - Date.now() + 1_000)
        const maximumLeaseWaitMs = Number(process.env.STAGING_RESTART_LEASE_WAIT_MAX_MS || 120_000)
        if (leaseWaitMs > maximumLeaseWaitMs) throw new Error(`restart lease wait ${leaseWaitMs}ms exceeds the configured safety bound`)
        if (leaseWaitMs) await new Promise((resolve) => setTimeout(resolve, leaseWaitMs))
      }
      await reconnectAgent(base, restartInput, restartJobId)
      const recovered = await pollJob(base, restartJobId, 30_000)
      if (recovered.status !== "done") throw new Error(`restart recovery ended as ${recovered.status}`)
      console.log("real process restart and database recovery: passed")

      const cancelJobId = await startAndDisconnectAgent(base, { ...agentInput, userInput: `${agentInput.userInput} Perform a multi-step analysis before answering.` })
      await expectStatus(await fetch(new URL(`/api/agent/jobs/${cancelJobId}`, base), { method: "DELETE", headers: headers() }), 200, "cancel")
      const cancelled = await pollJob(base, cancelJobId, 30_000)
      if (cancelled.status !== "cancelled") throw new Error(`explicit cancellation ended as ${cancelled.status}`)
      console.log("cancel: passed")
    }

    await expectStatus(await fetch(new URL(`/api/documents?id=${encodeURIComponent(documentId)}`, base), { method: "DELETE", headers: headers() }), 200, "document delete")
    await expectStatus(await fetch(new URL(`/api/documents/${documentId}/file`, base), { headers: headers() }), 404, "document file after delete")
    const afterDelete = await (await expectStatus(await fetch(new URL("/api/documents", base), { headers: headers() }), 200, "document list after delete")).json()
    if (afterDelete.items?.some((item) => item.id === documentId)) throw new Error("deleted document remains in the Library list")
    documentId = undefined
    console.log("document and private object deletion: passed")
  } finally {
    if (documentId) {
      let cleaned = false
      for (let attempt = 1; attempt <= 3 && !cleaned; attempt += 1) {
        try {
          const response = await fetch(new URL(`/api/documents?id=${encodeURIComponent(documentId)}`, base), { method: "DELETE", headers: headers() })
          cleaned = response.ok || response.status === 404
        } catch {}
        if (!cleaned && attempt < 3) await new Promise((resolve) => setTimeout(resolve, 2_000))
      }
      if (!cleaned) console.error(`cleanup could not delete staging smoke document ${documentId}`)
    }
  }
}

if (!shouldRun) printPlan()
else runSmoke().catch((error) => { console.error(error instanceof Error ? error.message : "Full staging release smoke failed"); process.exitCode = 1 })
