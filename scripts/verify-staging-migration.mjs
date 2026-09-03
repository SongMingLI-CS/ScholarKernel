#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const mode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--status")
    ? "status"
    : "plan"

function printPlan() {
  console.log([
    "PostgreSQL staging migration verification plan (no command executed):",
    "1. Back up or snapshot the staging clone.",
    "2. Run this script with --status for read-only Prisma validation/status.",
    "3. Review every pending migration, including the cancelled enum addition.",
    "4. Run this script with --apply to apply migrations to the confirmed staging clone.",
    "5. Run the SQL and application smoke checks documented in docs/deployment.md.",
  ].join("\n"))
}

function stagingEnvironment() {
  const rawUrl = process.env.STAGING_DATABASE_URL?.trim()
  if (!rawUrl) throw new Error("STAGING_DATABASE_URL is required")

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("STAGING_DATABASE_URL must be a valid URL")
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("STAGING_DATABASE_URL must use postgresql:// or postgres://")
  }

  const expectedHost = process.env.STAGING_EXPECTED_DB_HOST?.trim()
  if (!expectedHost) throw new Error("STAGING_EXPECTED_DB_HOST is required")
  if (parsed.hostname !== expectedHost) {
    throw new Error("STAGING_EXPECTED_DB_HOST does not match STAGING_DATABASE_URL")
  }
  if (process.env.STAGING_CONFIRMATION !== "scholarkernel-staging") {
    throw new Error("STAGING_CONFIRMATION must equal scholarkernel-staging")
  }

  return {
    ...process.env,
    DATABASE_URL: rawUrl,
    DIRECT_URL: rawUrl,
  }
}

function runPrisma(args, env) {
  const result = spawnSync("npx", ["prisma", ...args], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (mode === "plan") {
  printPlan()
} else {
  try {
    const env = stagingEnvironment()
    runPrisma(["validate"], env)
    runPrisma(["migrate", "status"], env)
    if (mode === "apply") {
      runPrisma(["migrate", "deploy"], env)
      runPrisma(["migrate", "status"], env)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Staging migration verification failed")
    process.exit(1)
  }
}
