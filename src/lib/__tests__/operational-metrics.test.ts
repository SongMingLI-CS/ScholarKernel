import { afterEach, describe, expect, it, vi } from "vitest"

import { recordOperationalMetric, setOperationalMetricSinkForTests } from "@/lib/operational-metrics"

describe("operational metrics", () => {
  afterEach(() => setOperationalMetricSinkForTests(undefined))

  it("records allowlisted timing and count fields without sensitive text", () => {
    const sink = vi.fn()
    setOperationalMetricSinkForTests(sink)
    recordOperationalMetric({
      name: "library.retrieval", durationMs: 12, lexicalMs: 4, vectorMs: 9,
      lexicalCandidates: 20, vectorCandidates: 18, selectedEvidence: 7,
      degradedReason: "vector-unavailable",
      query: "private research question", content: "private paper body", apiKey: "secret",
    } as never)
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      name: "library.retrieval", durationMs: 12, selectedEvidence: 7,
    }))
    const serialized = JSON.stringify(sink.mock.calls[0]?.[0])
    expect(serialized).not.toContain("private")
    expect(serialized).not.toContain("secret")
  })
})
