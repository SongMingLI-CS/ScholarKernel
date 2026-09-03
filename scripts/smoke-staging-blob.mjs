#!/usr/bin/env node

import { randomUUID } from "node:crypto"

const shouldRun = process.argv.includes("--run")

function printPlan() {
  console.log([
    "Vercel Blob staging smoke plan (no request sent):",
    "upload a generated marker document -> read and compare bytes -> index and retrieve marker -> delete the exact test document -> verify it is unavailable",
    "The script never deletes pre-existing documents and attempts cleanup if a later assertion fails.",
  ].join("\n"))
}

function stagingTarget() {
  const rawBase = process.env.STAGING_BASE_URL?.trim()
  if (!rawBase) throw new Error("STAGING_BASE_URL is required")

  let base
  try {
    base = new URL(rawBase)
  } catch {
    throw new Error("STAGING_BASE_URL must be a valid URL")
  }
  if (!new Set(["http:", "https:"]).has(base.protocol)) {
    throw new Error("STAGING_BASE_URL must use http:// or https://")
  }

  const expectedHost = process.env.STAGING_EXPECTED_HOST?.trim()
  if (!expectedHost) throw new Error("STAGING_EXPECTED_HOST is required")
  if (base.host !== expectedHost) {
    throw new Error("STAGING_EXPECTED_HOST does not match STAGING_BASE_URL")
  }
  if (process.env.STAGING_CONFIRMATION !== "scholarkernel-staging") {
    throw new Error("STAGING_CONFIRMATION must equal scholarkernel-staging")
  }
  base.pathname = "/"
  base.search = ""
  base.hash = ""
  return base
}

function requestHeaders(extra = {}) {
  const cookie = process.env.STAGING_AUTH_COOKIE?.trim()
  return {
    ...(cookie ? { cookie } : {}),
    ...extra,
  }
}

async function expectResponse(response, expected, step) {
  if (response.status !== expected) {
    throw new Error(`${step} returned HTTP ${response.status}; expected ${expected}`)
  }
  return response
}

async function removeTestDocument(base, id) {
  const endpoint = new URL(`/api/documents?id=${encodeURIComponent(id)}`, base)
  await expectResponse(
    await fetch(endpoint, { method: "DELETE", headers: requestHeaders() }),
    200,
    "delete"
  )
}

async function runSmoke() {
  const base = stagingTarget()
  const runId = randomUUID()
  const marker = `scholarkernel-blob-smoke-${runId}`
  const bodyText = `# ScholarKernel staging smoke\n\n${marker}\n\nThis generated document validates private object storage and chunk retrieval.\n`
  const form = new FormData()
  form.append("file", new Blob([bodyText], { type: "text/markdown" }), `${marker}.md`)
  form.append("title", marker)
  form.append("tags", JSON.stringify(["staging-smoke-test"]))

  let documentId = null
  let deleted = false
  try {
    const upload = await expectResponse(
      await fetch(new URL("/api/documents", base), {
        method: "POST",
        headers: requestHeaders(),
        body: form,
      }),
      201,
      "upload"
    )
    const uploaded = await upload.json()
    if (typeof uploaded?.id !== "string" || !uploaded.id) {
      throw new Error("upload response did not contain a document id")
    }
    if (typeof uploaded.fileUrl !== "string" || !uploaded.fileUrl.startsWith("object://")) {
      throw new Error("upload did not persist an object:// reference")
    }
    documentId = uploaded.id
    console.log("upload: passed")

    const read = await expectResponse(
      await fetch(new URL(`/api/documents/${encodeURIComponent(documentId)}/file`, base), {
        headers: requestHeaders(),
      }),
      200,
      "read"
    )
    if ((await read.text()) !== bodyText) throw new Error("read bytes did not match uploaded bytes")
    console.log("read: passed")

    const context = await expectResponse(
      await fetch(new URL("/api/documents/context", base), {
        method: "POST",
        headers: requestHeaders({ "content-type": "application/json" }),
        body: JSON.stringify({ documentIds: [documentId], query: marker }),
      }),
      200,
      "index"
    )
    const contextBody = await context.json()
    if (typeof contextBody?.context !== "string" || !contextBody.context.includes(marker)) {
      throw new Error("indexed retrieval did not return the smoke marker")
    }
    console.log("index: passed")

    await removeTestDocument(base, documentId)
    deleted = true
    console.log("delete: passed")

    const afterDelete = await fetch(
      new URL(`/api/documents/${encodeURIComponent(documentId)}/file`, base),
      { headers: requestHeaders() }
    )
    if (afterDelete.status !== 404) {
      throw new Error(`deleted document remained available (HTTP ${afterDelete.status})`)
    }
    console.log("post-delete verification: passed")
  } finally {
    if (documentId && !deleted) {
      await removeTestDocument(base, documentId).catch(() => {
        console.error("cleanup: failed; delete the reported staging smoke document through the authenticated Library UI")
      })
    }
  }
}

if (!shouldRun) {
  printPlan()
} else {
  runSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : "Blob staging smoke test failed")
    process.exitCode = 1
  })
}
