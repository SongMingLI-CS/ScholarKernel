import { createHash } from "node:crypto"

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]))
  return value
}

export function stableDagHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

export function dagNodeFingerprints(input: unknown, upstreamResults: Record<string, unknown>, protocolVersion = "dag-v1") {
  const inputHash = stableDagHash({ protocolVersion, input })
  const upstreamResultHash = stableDagHash(upstreamResults)
  return {
    inputHash,
    upstreamResultHash,
    idempotencyKey: stableDagHash({ inputHash, upstreamResultHash, protocolVersion }),
  }
}
