import { afterEach, describe, expect, it, vi } from "vitest"

import { DeterministicFakeEmbeddingProvider, embeddingRuntimeConfig, OpenAICompatibleEmbeddingProvider } from "@/lib/embedding-provider"

describe("embedding provider abstraction", () => {
  afterEach(() => vi.restoreAllMocks())

  it("uses a deterministic fake without a paid API", async () => {
    const provider = new DeterministicFakeEmbeddingProvider()
    const first = await provider.embed(["same text", "different text"])
    const second = await provider.embed(["same text", "different text"])
    expect(first).toEqual(second)
    expect(first[0]).toHaveLength(provider.dimensions)
    expect(first[0]).not.toEqual(first[1])
  })

  it("bounds operator-controlled batch, retry, and rate settings", () => {
    expect(embeddingRuntimeConfig({
      EMBEDDING_BATCH_SIZE: "999", EMBEDDING_MAX_ATTEMPTS: "0",
      EMBEDDING_BACKOFF_MS: "250", EMBEDDING_REQUESTS_PER_MINUTE: "120",
    })).toEqual({ batchSize: 128, maxAttempts: 1, backoffMs: 250, requestsPerMinute: 120 })
  })

  it("retries transient embedding responses with controlled backoff", async () => {
    const vector = Array.from({ length: 1536 }, () => 0.01)
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: vector }] }))
    const provider = new OpenAICompatibleEmbeddingProvider("embed-v1", "secret", "https://embedding.test/v1", {
      maxAttempts: 2, backoffMs: 0, requestsPerMinute: 0,
    })
    await expect(provider.embed(["safe text"])).resolves.toEqual([vector])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not retry a permanent embedding request error", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 400 }))
    const provider = new OpenAICompatibleEmbeddingProvider("embed-v1", "secret", "https://embedding.test/v1", {
      maxAttempts: 3, backoffMs: 0, requestsPerMinute: 0,
    })
    await expect(provider.embed(["safe text"])).rejects.toThrow("EmbeddingHttpError:400")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
