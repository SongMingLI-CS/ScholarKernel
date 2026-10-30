import { describe, expect, it, vi } from "vitest"

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { document: { findFirst } } }))

import { readOwnedDocument } from "@/lib/document-service"

describe("owned document reading", () => {
  it("reads a saved academic document for the current user", async () => {
    findFirst.mockResolvedValueOnce({ id: "doc-1", title: "Paper", content: "Academic content", version: 1 })
    const result = await readOwnedDocument("user-1", "doc-1")
    expect(result).toMatchObject({ ok: true, documentId: "doc-1", text: "Academic content" })
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "doc-1", conversation: { userId: "user-1" } },
    }))
  })

  it("reports a missing document without attempting a filesystem fallback", async () => {
    findFirst.mockResolvedValueOnce(null)
    await expect(readOwnedDocument("user-1", "missing-doc")).resolves.toMatchObject({ ok: false, error: "DocumentNotFound" })
  })
})
