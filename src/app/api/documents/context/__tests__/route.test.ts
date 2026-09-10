import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolve: vi.fn(),
  format: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({ resolveUserIdFromRequest: mocks.auth }))
vi.mock("@/lib/library-resolve", () => ({ resolveLibraryEvidenceForAgent: mocks.resolve }))
vi.mock("@/lib/library-rag", () => ({ formatStructuredLibraryEvidence: mocks.format }))

import { POST } from "../route"

describe("POST /api/documents/context retrieval diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue("user-1")
    mocks.format.mockReturnValue("formatted evidence")
  })

  it("reports hybrid mode and the number of selected vector-backed evidence units", async () => {
    mocks.resolve.mockResolvedValue({
      retrievalMode: "hybrid",
      statuses: [],
      evidence: [
        { vectorRank: 1 },
        { vectorRank: null },
        { vectorRank: 2 },
      ],
    })
    const response = await POST(new Request("http://localhost/api/documents/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentIds: ["doc-1"], query: "test query" }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      context: "formatted evidence",
      documentIds: ["doc-1"],
      retrievalMode: "hybrid",
      vectorEvidenceCount: 2,
    })
    expect(mocks.resolve).toHaveBeenCalledWith("user-1", ["doc-1"], "test query")
  })

  it("reports an explicit lexical mode for an empty selection", async () => {
    const response = await POST(new Request("http://localhost/api/documents/context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documentIds: [] }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      context: "",
      documentIds: [],
      retrievalMode: "lexical-degraded",
      vectorEvidenceCount: 0,
    })
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
})
