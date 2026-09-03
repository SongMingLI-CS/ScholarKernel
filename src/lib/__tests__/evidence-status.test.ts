import { describe, expect, it } from "vitest"

import { hasDegradedEvidence, mergeEvidenceStatuses } from "@/lib/evidence-status"

describe("evidence status presentation model", () => {
  it("replaces repeated source identities while preserving other statuses", () => {
    const merged = mergeEvidenceStatuses(
      [
        { id: "library:1", kind: "library", label: "Paper", state: "missing" },
        { id: "search:n1", kind: "search", label: "query", state: "loaded", sourceCount: 3 },
      ],
      [{ id: "library:1", kind: "library", label: "Paper", state: "loaded", sourceCount: 8 }]
    )
    expect(merged).toHaveLength(2)
    expect(merged.find((status) => status.id === "library:1")).toMatchObject({ state: "loaded", sourceCount: 8 })
  })

  it("marks missing, failed, and degraded evidence as disclosure-worthy", () => {
    expect(hasDegradedEvidence([{ id: "x", kind: "file", label: "x", state: "loaded" }])).toBe(false)
    expect(hasDegradedEvidence([{ id: "x", kind: "file", label: "x", state: "degraded" }])).toBe(true)
  })
})
