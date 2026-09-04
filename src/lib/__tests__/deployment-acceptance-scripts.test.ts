import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

const repoRoot = path.resolve(__dirname, "../../..")
const temporaryDirectories: string[] = []

function run(script: string, args: string[] = [], env: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, [path.join(repoRoot, "scripts", script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...env, NODE_ENV: "test", PATH: env.PATH ?? process.env.PATH },
  })
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("staging migration verifier", () => {
  it("defaults to a non-mutating plan", () => {
    const result = run("verify-staging-migration.mjs")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("status")
    expect(result.stdout).toContain("apply")
  })

  it("refuses status checks without an explicitly named staging database", () => {
    const result = run("verify-staging-migration.mjs", ["--status"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("STAGING_DATABASE_URL")
  })

  it("allows an expected pending status before apply but still verifies status afterward", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sk-prisma-stub-"))
    temporaryDirectories.push(directory)
    const statePath = path.join(directory, "status-seen")
    const logPath = path.join(directory, "commands.log")
    const npxPath = path.join(directory, "npx")
    writeFileSync(
      npxPath,
      `#!/usr/bin/env node
const fs = require("node:fs")
const command = process.argv.slice(2).join(" ")
fs.appendFileSync(process.env.FAKE_PRISMA_LOG, command + "\\n")
if (command === "prisma migrate status" && !fs.existsSync(process.env.FAKE_PRISMA_STATE)) {
  fs.writeFileSync(process.env.FAKE_PRISMA_STATE, "seen")
  console.log("Following migration have not yet been applied:")
  process.exit(1)
}
console.log("ok")
`,
    )
    chmodSync(npxPath, 0o755)

    const result = run("verify-staging-migration.mjs", ["--apply"], {
      STAGING_DATABASE_URL: "postgresql://example.invalid/staging",
      STAGING_EXPECTED_DB_HOST: "example.invalid",
      STAGING_CONFIRMATION: "scholarkernel-staging",
      FAKE_PRISMA_STATE: statePath,
      FAKE_PRISMA_LOG: logPath,
      PATH: `${directory}:${process.env.PATH}`,
    })

    expect(result.status).toBe(0)
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toEqual([
      "prisma validate",
      "prisma migrate status",
      "prisma migrate deploy",
      "prisma migrate status",
    ])
  })

  it("keeps the cancelled enum migration additive and repeatable", () => {
    const migration = readFileSync(
      path.join(repoRoot, "prisma/migrations/20260902203000_agent_job_cancelled/migration.sql"),
      "utf8"
    )
    expect(migration).toMatch(/ALTER TYPE "AgentJobStatus" ADD VALUE IF NOT EXISTS 'cancelled'/)
    expect(migration).not.toMatch(/DROP\s+(?:TYPE|TABLE|COLUMN)|DELETE\s+FROM|UPDATE\s+/i)
  })

  it("migrates the legacy Canvas table without dropping user data and creates every current model", () => {
    const migration = readFileSync(
      path.join(repoRoot, "prisma/migrations/20260903213000_schema_alignment/migration.sql"),
      "utf8"
    )

    expect(migration).toMatch(/ALTER TABLE "Document" RENAME TO "CanvasDocument"/)
    expect(migration).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "Document"/)
    expect(migration).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "AgentNode"/)
    expect(migration).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "UserBilling"/)
    expect(migration).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "TokenAuditLog"/)
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i)
  })

  it("adds Canvas sharing fields without destructive schema operations", () => {
    const migration = readFileSync(
      path.join(repoRoot, "prisma/migrations/20260903220000_canvas_sharing_alignment/migration.sql"),
      "utf8"
    )

    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS "isShared" BOOLEAN NOT NULL DEFAULT false/)
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS "shareToken" TEXT/)
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "CanvasDocument_shareToken_key"/)
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+/i)
  })
})

describe("Blob lifecycle smoke test", () => {
  it("defaults to the upload/read/index/delete plan without network access", () => {
    const result = run("smoke-staging-blob.mjs")
    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/upload[\s\S]*read[\s\S]*index[\s\S]*delete/i)
  })

  it("refuses execution without an explicitly confirmed staging target", () => {
    const result = run("smoke-staging-blob.mjs", ["--run"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("STAGING_BASE_URL")
  })
})

describe("client bundle credential audit", () => {
  it("routes Settings cloud diagnostics through stored server credentials", () => {
    const setupGuide = readFileSync(path.join(repoRoot, "src/components/setup-guide.tsx"), "utf8")
    expect(setupGuide).toContain("validateStoredProvider")
    expect(setupGuide).not.toMatch(/getState\(\)\.runtimeKeys/)
  })

  it("does not describe provider keys as browser-persisted or SQLite-backed", () => {
    const locales = readFileSync(path.join(repoRoot, "src/lib/locales.ts"), "utf8")
    expect(locales).not.toMatch(/runtime keys in sessionStorage|运行时密钥在 sessionStorage/)
    expect(locales).not.toMatch(/Local SQLite|本机 SQLite/)
  })

  it("passes clean assets and never echoes a matched credential", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "sk-client-audit-"))
    temporaryDirectories.push(directory)
    writeFileSync(path.join(directory, "clean.js"), "console.log('client')")

    const clean = run("audit-client-bundle.mjs", ["--dir", directory])
    expect(clean.status).toBe(0)
    expect(clean.stdout).toContain("0 credential-like literals")

    const fakeSecret = "sk-proj-THIS_IS_A_FAKE_SECRET_123456789"
    writeFileSync(path.join(directory, "leak.js"), `window.key='${fakeSecret}'`)
    const leaked = run("audit-client-bundle.mjs", ["--dir", directory])
    expect(leaked.status).not.toBe(0)
    expect(leaked.stderr).toContain("OpenAI-style key")
    expect(leaked.stderr).toContain("leak.js")
    expect(leaked.stderr).not.toContain(fakeSecret)
  })
})
