export type DenseEmbeddingBatch = {
  model: string
  revision: string
  dimensions: number
  vectors: number[][]
}

export type DenseEmbeddingProvider = {
  model: string
  revision: string
  dimensions?: number
  embedBatch(texts: string[], signal?: AbortSignal): Promise<DenseEmbeddingBatch>
}

const EMBEDDING_TIMEOUT_MS = 20_000
const EMBEDDING_BATCH_SIZE = 32

function normalizeVector(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    throw new Error("InvalidEmbeddingVector")
  }
  const vector = raw as number[]
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (!Number.isFinite(norm) || norm <= 0) throw new Error("InvalidEmbeddingNorm")
  return vector.map((value) => value / norm)
}

function timeoutSignal(parent?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const abort = () => controller.abort(parent?.reason)
  if (parent?.aborted) abort()
  else parent?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error("EmbeddingTimeout")), EMBEDDING_TIMEOUT_MS)
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true })
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      parent?.removeEventListener("abort", abort)
    },
  }
}

export function createHttpEmbeddingProvider(options: {
  endpoint: string
  model: string
  revision: string
  dimensions?: number
}): DenseEmbeddingProvider {
  return {
    model: options.model,
    revision: options.revision,
    dimensions: options.dimensions,
    async embedBatch(texts, signal) {
      if (!texts.length) return { model: options.model, revision: options.revision, dimensions: options.dimensions ?? 0, vectors: [] }
      const vectors: number[][] = []
      let dimensions = options.dimensions ?? 0
      for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
        const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE)
        const timeout = timeoutSignal(signal)
        let response: Response
        let body: unknown
        try {
          response = await fetch(options.endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: options.model, revision: options.revision, input: batch, normalize: true }),
            signal: timeout.signal,
          })
          if (response.ok) body = await response.json()
        } finally {
          timeout.cleanup()
        }
        if (!response.ok) throw new Error(`EmbeddingServiceHttp${response.status}`)
        const parsed = body as { model?: unknown; revision?: unknown; dimensions?: unknown; embeddings?: unknown }
        if (parsed.model !== options.model || parsed.revision !== options.revision || !Array.isArray(parsed.embeddings)) {
          throw new Error("EmbeddingServiceVersionMismatch")
        }
        if (parsed.embeddings.length !== batch.length) throw new Error("EmbeddingBatchSizeMismatch")
        const currentDimensions = typeof parsed.dimensions === "number" ? parsed.dimensions : 0
        if (!Number.isInteger(currentDimensions) || currentDimensions <= 0) throw new Error("EmbeddingDimensionsMissing")
        if (options.dimensions !== undefined && currentDimensions !== options.dimensions) throw new Error("EmbeddingDimensionsMismatch")
        if (dimensions && currentDimensions !== dimensions) throw new Error("EmbeddingDimensionsChanged")
        dimensions = currentDimensions
        for (const raw of parsed.embeddings) {
          const vector = normalizeVector(raw)
          if (vector.length !== dimensions) throw new Error("EmbeddingVectorDimensionsMismatch")
          vectors.push(vector)
        }
      }
      return { model: options.model, revision: options.revision, dimensions, vectors }
    },
  }
}

export function configuredLocalEmbeddingProvider(): DenseEmbeddingProvider | null {
  const endpoint = process.env.LOCAL_EMBEDDING_API_URL?.trim()
  const revision = process.env.LOCAL_EMBEDDING_REVISION?.trim()
  if (!endpoint || !revision) return null
  const model = process.env.LOCAL_EMBEDDING_MODEL?.trim() || "BAAI/bge-m3"
  const rawDimensions = Number(process.env.LOCAL_EMBEDDING_DIMENSIONS ?? "1024")
  return createHttpEmbeddingProvider({
    endpoint,
    model,
    revision,
    ...(Number.isInteger(rawDimensions) && rawDimensions > 0 ? { dimensions: rawDimensions } : {}),
  })
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return Number.NEGATIVE_INFINITY
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!
    const b = right[index]!
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NEGATIVE_INFINITY
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm <= 0 || rightNorm <= 0) return Number.NEGATIVE_INFINITY
  return dot / Math.sqrt(leftNorm * rightNorm)
}

export function readStoredEmbedding(value: unknown): number[] | null {
  try {
    return normalizeVector(value)
  } catch {
    return null
  }
}
