import { describe, expect, it } from "vitest"

import {
  buildAgentRunPayload,
  filterLibraryByFolder,
  formatLibraryContextBlock,
  serializeLibraryDocument,
  validateLibrarySelection,
  type LibraryDocumentRecord,
} from "@/lib/my-library"

function mockDoc(overrides: Partial<LibraryDocumentRecord> = {}): LibraryDocumentRecord {
  return {
    id: "doc-a-1",
    userId: "user-1",
    title: "Attention Is All You Need",
    fileUrl: "file:///data/library/user-1/doc-a-1_paper.pdf",
    fileSize: 2048,
    fileType: "application/pdf",
    tags: ["nlp"],
    folders: ["survey"],
    createdAt: "2026-06-01T10:00:00.000Z",
    ...overrides,
  }
}

describe("my-library", () => {
  it("session A upload appears in global library serialization", () => {
    const uploaded = serializeLibraryDocument({
      id: "doc-session-a",
      userId: "user-1",
      title: "BERT Pretraining",
      fileUrl: "file:///data/library/user-1/doc-session-a_bert.pdf",
      fileSize: 4096,
      fileType: "application/pdf",
      tags: [],
      folders: [],
      createdAt: new Date("2026-06-10T08:00:00.000Z"),
    })

    const globalLibrary: LibraryDocumentRecord[] = [mockDoc(), uploaded]
    const found = globalLibrary.find((d) => d.id === "doc-session-a")
    expect(found).toBeDefined()
    expect(found?.title).toBe("BERT Pretraining")
    expect(found?.userId).toBe("user-1")
  })

  it("session B multi-select captures documentIds in agent payload", () => {
    const globalLibrary: LibraryDocumentRecord[] = [
      mockDoc({ id: "doc-a-1", title: "Paper from session A" }),
      mockDoc({ id: "doc-b-2", title: "Another paper" }),
      mockDoc({ id: "doc-c-3", title: "Third paper" }),
    ]

    const sessionBSelection = ["doc-a-1", "doc-b-2", "doc-c-3"]
    const validated = validateLibrarySelection(sessionBSelection, globalLibrary)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return

    const payload = buildAgentRunPayload("请对比这三篇论文的方法论差异", validated.documentIds)
    expect(payload.documentIds).toEqual(["doc-a-1", "doc-b-2", "doc-c-3"])
    expect(payload.userInput).toContain("方法论")
  })

  it("rejects foreign documentIds not owned by user library", () => {
    const globalLibrary = [mockDoc({ id: "owned-1" })]
    const result = validateLibrarySelection(["owned-1", "foreign-9"], globalLibrary)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.missing).toContain("foreign-9")
  })

  it("filterLibraryByFolder supports all, uncategorized, and custom folders", () => {
    const docs = [
      mockDoc({ id: "1", folders: [] }),
      mockDoc({ id: "2", folders: ["grant"] }),
      mockDoc({ id: "3", folders: ["grant", "survey"] }),
    ]
    expect(filterLibraryByFolder(docs, "all")).toHaveLength(3)
    expect(filterLibraryByFolder(docs, "uncategorized").map((d) => d.id)).toEqual(["1"])
    expect(filterLibraryByFolder(docs, "grant").map((d) => d.id)).toEqual(["2", "3"])
  })

  it("formatLibraryContextBlock wraps injected corpus for agent workflow", () => {
    const block = formatLibraryContextBlock([
      { title: "Paper A", fileType: "application/pdf", text: "Abstract about transformers." },
    ])
    expect(block).toContain("我的文献库")
    expect(block).toContain("Paper A")
    expect(block).toContain("transformers")
  })
})
