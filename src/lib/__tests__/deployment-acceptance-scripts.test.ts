import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
    env: { ...env, NODE_ENV: "test", PATH: process.env.PATH },
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

  it("keeps the cancelled enum migration additive and repeatable", () => {
    const migration = readFileSync(
      path.join(repoRoot, "prisma/migrations/20260902203000_agent_job_cancelled/migration.sql"),
      "utf8"
    )
    expect(migration).toMatch(/ALTER TYPE "AgentJobStatus" ADD VALUE IF NOT EXISTS 'cancelled'/)
    expect(migration).not.toMatch(/DROP\s+(?:TYPE|TABLE|COLUMN)|DELETE\s+FROM|UPDATE\s+/i)
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
