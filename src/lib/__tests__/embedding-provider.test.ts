import { describe, expect, it } from "vitest"

import { DeterministicFakeEmbeddingProvider } from "@/lib/embedding-provider"

describe("embedding provider abstraction", () => {
  it("uses a deterministic fake without a paid API", async () => {
    const provider = new DeterministicFakeEmbeddingProvider()
    const first = await provider.embed(["same text", "different text"])
    const second = await provider.embed(["same text", "different text"])
    expect(first).toEqual(second)
    expect(first[0]).toHaveLength(provider.dimensions)
    expect(first[0]).not.toEqual(first[1])
  })
})
