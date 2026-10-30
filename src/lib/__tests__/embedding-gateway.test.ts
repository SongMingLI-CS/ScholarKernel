import { afterEach, describe, expect, it, vi } from "vitest"

import { cosineSimilarity, createHttpEmbeddingProvider, readStoredEmbedding } from "@/lib/document/embedding-gateway"

describe("local embedding gateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("batches requests at 32, checks model identity, and normalizes vectors", async () => {
    const requests: Array<{ input: string[]; normalize: boolean; revision: string }> = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[]; revision: string; normalize: boolean }
      requests.push(body)
      return new Response(JSON.stringify({
        model: "fixture-embedder",
        revision: body.revision,
        dimensions: 2,
        embeddings: body.input.map(() => [3, 4]),
      }), { status: 200, headers: { "content-type": "application/json" } })
    }))
    const provider = createHttpEmbeddingProvider({
      endpoint: "http://127.0.0.1:8999/v1/embeddings",
      model: "fixture-embedder",
      revision: "pinned-test-revision",
      dimensions: 2,
    })

    const result = await provider.embedBatch(Array.from({ length: 33 }, (_, index) => `text ${index}`))

    expect(requests.map((request) => request.input.length)).toEqual([32, 1])
    expect(requests.every((request) => request.normalize)).toBe(true)
    expect(result.dimensions).toBe(2)
    expect(result.vectors).toHaveLength(33)
    expect(result.vectors[0]).toEqual([0.6, 0.8])
  })

  it("returns no vectors for an empty batch without calling the service", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const provider = createHttpEmbeddingProvider({ endpoint: "http://127.0.0.1:8999", model: "m", revision: "r" })

    await expect(provider.embedBatch([])).resolves.toEqual({ model: "m", revision: "r", dimensions: 0, vectors: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects mismatched model revisions, dimensions, and invalid vectors", async () => {
    const provider = createHttpEmbeddingProvider({ endpoint: "http://127.0.0.1:8999", model: "m", revision: "r", dimensions: 2 })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "m",
      revision: "other",
      dimensions: 2,
      embeddings: [[1, 0]],
    }), { status: 200, headers: { "content-type": "application/json" } })))
    await expect(provider.embedBatch(["x"])).rejects.toThrow("EmbeddingServiceVersionMismatch")

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "m",
      revision: "r",
      dimensions: 3,
      embeddings: [[1, 0, 0]],
    }), { status: 200, headers: { "content-type": "application/json" } })))
    await expect(provider.embedBatch(["x"])).rejects.toThrow("EmbeddingDimensionsMismatch")

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "m",
      revision: "r",
      dimensions: 2,
      embeddings: [[0, 0]],
    }), { status: 200, headers: { "content-type": "application/json" } })))
    await expect(provider.embedBatch(["x"])).rejects.toThrow("InvalidEmbeddingNorm")
  })

  it("computes cosine similarity and safely reads persisted vectors", () => {
    expect(cosineSimilarity([1, 0], [3, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([1], [1, 0])).toBe(Number.NEGATIVE_INFINITY)
    expect(readStoredEmbedding([3, 4])).toEqual([0.6, 0.8])
    expect(readStoredEmbedding([0, 0])).toBeNull()
  })
})
