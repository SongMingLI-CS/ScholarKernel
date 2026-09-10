import { createHash } from "node:crypto"
import { recordOperationalMetric } from "@/lib/operational-metrics"

export const EMBEDDING_DIMENSIONS = 1536

export type EmbeddingProvider = {
  readonly modelVersion: string
  readonly dimensions: number
  embed(texts: string[]): Promise<number[][]>
}

export type EmbeddingRuntimeConfig = {
  batchSize: number
  maxAttempts: number
  backoffMs: number
  requestsPerMinute: number
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback
}

export function embeddingRuntimeConfig(env: Record<string, string | undefined> = process.env): EmbeddingRuntimeConfig {
  return {
    batchSize: boundedInteger(env.EMBEDDING_BATCH_SIZE, 32, 1, 128),
    maxAttempts: boundedInteger(env.EMBEDDING_MAX_ATTEMPTS, 3, 1, 6),
    backoffMs: boundedInteger(env.EMBEDDING_BACKOFF_MS, 500, 0, 30_000),
    requestsPerMinute: boundedInteger(env.EMBEDDING_REQUESTS_PER_MINUTE, 60, 0, 600),
  }
}

const nextRequestAtByEndpoint = new Map<string, number>()

async function wait(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS

  constructor(
    readonly modelVersion: string,
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    policy: Partial<Pick<EmbeddingRuntimeConfig, "maxAttempts" | "backoffMs" | "requestsPerMinute">> = {}
  ) {
    const defaults = embeddingRuntimeConfig()
    this.policy = { ...defaults, ...policy }
  }

  private readonly policy: EmbeddingRuntimeConfig

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return []
    const startedAt = performance.now()
    let attemptsMade = 0
    const endpoint = `${this.baseUrl.replace(/\/$/, "")}/embeddings`
    let lastError: unknown
    for (let attempt = 1; attempt <= this.policy.maxAttempts; attempt += 1) {
      attemptsMade = attempt
      const intervalMs = this.policy.requestsPerMinute > 0 ? Math.ceil(60_000 / this.policy.requestsPerMinute) : 0
      const now = Date.now()
      const nextAt = nextRequestAtByEndpoint.get(endpoint) ?? now
      await wait(Math.max(0, nextAt - now))
      nextRequestAtByEndpoint.set(endpoint, Date.now() + intervalMs)
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({ model: this.modelVersion, input: texts, dimensions: this.dimensions }),
        })
        if (!response.ok) {
          const error = new Error(`EmbeddingHttpError:${response.status}`)
          const retryable = response.status === 408 || response.status === 409 || response.status === 425 || response.status === 429 || response.status >= 500
          if (!retryable || attempt === this.policy.maxAttempts) throw error
          lastError = error
        } else {
          const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> }
          const rows = [...(payload.data ?? [])].sort((a, b) => a.index - b.index).map((row) => row.embedding)
          if (rows.length !== texts.length || rows.some((row) => row.length !== this.dimensions)) throw new Error("EmbeddingResponseInvalid")
          recordOperationalMetric({
            name: "library.embedding", durationMs: performance.now() - startedAt,
            embeddingRequests: attemptsMade, chunkCount: texts.length,
            estimatedTokens: Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4),
            costUsd: null, status: "ready",
          })
          return rows
        }
      } catch (error) {
        const permanent = error instanceof Error && /^EmbeddingHttpError:4(?!08|09|25|29)/.test(error.message)
        if (permanent || attempt === this.policy.maxAttempts) {
          recordOperationalMetric({
            name: "library.embedding", durationMs: performance.now() - startedAt,
            embeddingRequests: attemptsMade, chunkCount: texts.length,
            estimatedTokens: Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4),
            costUsd: null, status: "failed",
          })
          throw error
        }
        lastError = error
      }
      await wait(this.policy.backoffMs * 2 ** (attempt - 1))
    }
    recordOperationalMetric({
      name: "library.embedding", durationMs: performance.now() - startedAt,
      embeddingRequests: attemptsMade, chunkCount: texts.length,
      estimatedTokens: Math.ceil(texts.reduce((sum, text) => sum + text.length, 0) / 4),
      costUsd: null, status: "failed",
    })
    throw lastError instanceof Error ? lastError : new Error("EmbeddingRequestFailed")
  }
}

function isVercelAiGatewayBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname === "ai-gateway.vercel.sh" && /^\/v1\/?$/.test(url.pathname)
  } catch {
    return false
  }
}

export function configuredEmbeddingProvider(
  env: Record<string, string | undefined> = process.env
): EmbeddingProvider | null {
  // Embeddings remain opt-in: OIDC is considered only for an explicitly selected
  // Vercel AI Gateway endpoint, never merely because Vercel injected a token.
  const baseUrl = env.EMBEDDING_BASE_URL?.trim() || "https://api.openai.com/v1"
  const usesVercelGateway = isVercelAiGatewayBaseUrl(baseUrl)
  const apiKey = env.EMBEDDING_API_KEY?.trim() || (
    usesVercelGateway
      ? env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim()
      : undefined
  )
  if (!apiKey) return null
  return new OpenAICompatibleEmbeddingProvider(
    env.EMBEDDING_MODEL?.trim() || (usesVercelGateway ? "openai/text-embedding-3-small" : "text-embedding-3-small"),
    apiKey,
    baseUrl,
    embeddingRuntimeConfig(env)
  )
}

/** Deterministic, offline provider for tests and repeatable evaluation only. */
export class DeterministicFakeEmbeddingProvider implements EmbeddingProvider {
  constructor(readonly modelVersion = "fake-embedding-v1", readonly dimensions = 16) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const digest = createHash("sha256").update(text).digest()
      const values = Array.from({ length: this.dimensions }, (_, index) => (digest[index % digest.length]! / 127.5) - 1)
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1
      return values.map((value) => value / norm)
    })
  }
}
