#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import path from "node:path"

const shouldRun = process.argv.includes("--run")

function printPlan() {
  console.log([
    "Hybrid RAG/DAG staging verification plan (no connection made):",
    "1. Verify the pgvector extension and vector(1536) column.",
    "2. Verify the partial HNSW cosine index.",
    "3. Verify both additive migrations are finished.",
    "4. Execute read-only legacy Document, chunk, checkpoint, and workflow compatibility queries.",
  ].join("\n"))
}

function stagingEnvironment() {
  const rawUrl = process.env.STAGING_DATABASE_URL?.trim()
  if (!rawUrl) throw new Error("STAGING_DATABASE_URL is required")
  const parsed = new URL(rawUrl)
  if (!new Set(["postgresql:", "postgres:"]).has(parsed.protocol)) throw new Error("STAGING_DATABASE_URL must use PostgreSQL")
  const expectedHost = process.env.STAGING_EXPECTED_DB_HOST?.trim()
  if (!expectedHost || parsed.hostname !== expectedHost) throw new Error("STAGING_EXPECTED_DB_HOST does not match STAGING_DATABASE_URL")
  if (process.env.STAGING_CONFIRMATION !== "scholarkernel-staging") throw new Error("STAGING_CONFIRMATION must equal scholarkernel-staging")
  return { ...process.env, DATABASE_URL: rawUrl, DIRECT_URL: rawUrl }
}

if (!shouldRun) {
  printPlan()
} else {
  try {
    const result = spawnSync("npx", ["prisma", "db", "execute", "--file", path.join("scripts", "sql", "verify-hybrid-rag-dag.sql")], {
      cwd: process.cwd(), env: stagingEnvironment(), encoding: "utf8",
    })
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
    console.log("pgvector, HNSW, migrations, and legacy compatibility reads: passed")
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Staging RAG/DAG verification failed")
    process.exit(1)
  }
}
