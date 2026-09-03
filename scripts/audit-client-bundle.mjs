#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const directoryArgIndex = process.argv.indexOf("--dir")
const root = path.resolve(
  directoryArgIndex >= 0 && process.argv[directoryArgIndex + 1]
    ? process.argv[directoryArgIndex + 1]
    : ".next/static"
)

const credentialPatterns = [
  {
    label: "OpenAI-style key",
    pattern: /(?:sk-(?:proj-|svcacct-)[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{40,})/g,
  },
  { label: "Anthropic-style key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { label: "Tavily-style key", pattern: /tvly-[A-Za-z0-9_-]{16,}/g },
  { label: "Vercel Blob token", pattern: /vercel_blob_rw_[A-Za-z0-9_-]{12,}/g },
  { label: "credentialed PostgreSQL URL", pattern: /postgres(?:ql)?:\/\/[^\s:'"`]+:[^\s@'"`]+@/g },
  { label: "private key material", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: "synthetic client audit sentinel", pattern: /SK_CLIENT_AUDIT_[A-Z0-9_-]{8,}/g },
]

function filesUnder(directory) {
  const out = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(absolute))
    else if (entry.isFile()) out.push(absolute)
  }
  return out
}

try {
  if (!statSync(root).isDirectory()) throw new Error("client bundle path is not a directory")
  const findings = []
  for (const file of filesUnder(root)) {
    const content = readFileSync(file, "utf8")
    for (const candidate of credentialPatterns) {
      candidate.pattern.lastIndex = 0
      if (candidate.pattern.test(content)) {
        findings.push({ label: candidate.label, file: path.relative(root, file) })
      }
    }
  }

  if (findings.length) {
    for (const finding of findings) {
      console.error(`${finding.label}: ${finding.file}`)
    }
    console.error(`${findings.length} credential-like literal finding(s); matched values were not printed`)
    process.exit(1)
  }
  console.log(`Client bundle audit passed: 0 credential-like literals in ${filesUnder(root).length} files`)
} catch (error) {
  console.error(error instanceof Error ? error.message : "Client bundle audit failed")
  process.exit(1)
}
