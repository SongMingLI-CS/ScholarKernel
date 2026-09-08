import { createHash } from "node:crypto"

export const EMBEDDING_DIMENSIONS = 1536

export type EmbeddingProvider = {
  readonly modelVersion: string
  readonly dimensions: number
  embed(texts: string[]): Promise<number[][]>
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS

  constructor(
    readonly modelVersion: string,
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1"
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return []
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.modelVersion, input: texts, dimensions: this.dimensions }),
    })
    if (!response.ok) throw new Error(`EmbeddingHttpError:${response.status}`)
    const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> }
    const rows = [...(payload.data ?? [])].sort((a, b) => a.index - b.index).map((row) => row.embedding)
    if (rows.length !== texts.length || rows.some((row) => row.length !== this.dimensions)) throw new Error("EmbeddingResponseInvalid")
    return rows
  }
}

export function configuredEmbeddingProvider(): EmbeddingProvider | null {
  // Embeddings are opt-in to avoid silently spending a chat-provider key.
  const apiKey = process.env.EMBEDDING_API_KEY?.trim()
  if (!apiKey) return null
  return new OpenAICompatibleEmbeddingProvider(
    process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    apiKey,
    process.env.EMBEDDING_BASE_URL?.trim() || "https://api.openai.com/v1"
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
