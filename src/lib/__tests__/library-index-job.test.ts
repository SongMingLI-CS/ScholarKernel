import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  after: vi.fn(), createJob: vi.fn(), claimJob: vi.fn(), completeJob: vi.fn(), failJob: vi.fn(),
  withHeartbeat: vi.fn(async (_id: string, operation: () => Promise<unknown>) => operation()),
  findDocument: vi.fn(), countChunks: vi.fn(), updateDocument: vi.fn(), readObject: vi.fn(), index: vi.fn(),
}))

vi.mock("next/server", async (loadOriginal) => ({ ...(await loadOriginal<typeof import("next/server")>()), after: mocks.after }))
vi.mock("@/lib/agent-jobs", () => ({
  createAgentJob: mocks.createJob, claimAgentJobRun: mocks.claimJob,
  completeAgentJob: mocks.completeJob, failAgentJob: mocks.failJob,
  withAgentJobHeartbeat: mocks.withHeartbeat,
}))
vi.mock("@/lib/prisma", () => ({ prisma: {
  document: { findFirst: mocks.findDocument, update: mocks.updateDocument },
  documentChunk: { count: mocks.countChunks },
} }))
vi.mock("@/lib/library-storage", () => ({ readStoredLibraryObject: mocks.readObject }))
vi.mock("@/lib/embedding-provider", () => ({ configuredEmbeddingProvider: vi.fn(() => null) }))
vi.mock("@/lib/library-index", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@/lib/library-index")>()
  return { ...original, indexLibraryDocumentBuffer: mocks.index }
})

import { runLibraryIndexJob, scheduleLibraryIndexJob } from "@/lib/library-index-job"
import { libraryIndexFingerprint } from "@/lib/library-index"

describe("Library indexing on the existing Job lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createJob.mockResolvedValue({ id: "job-1" })
    mocks.updateDocument.mockResolvedValue({})
    mocks.claimJob.mockResolvedValue(true)
    mocks.completeJob.mockResolvedValue({})
    mocks.failJob.mockResolvedValue({})
    mocks.readObject.mockResolvedValue(Buffer.from("same-file"))
    mocks.countChunks.mockResolvedValue(2)
  })

  it("schedules after the response lifecycle instead of awaiting indexing", async () => {
    expect(await scheduleLibraryIndexJob("user-1", "doc-1")).toBe("job-1")
    expect(mocks.after).toHaveBeenCalledWith(expect.any(Function))
    expect(mocks.index).not.toHaveBeenCalled()
  })

  it("does not re-index or re-embed an unchanged file and version", async () => {
    const fingerprint = libraryIndexFingerprint(Buffer.from("same-file"), null)
    mocks.findDocument.mockResolvedValue({
      id: "doc-1", userId: "user-1", title: "paper.txt", fileType: "text/plain", fileUrl: "object://paper",
      // Scheduling a reindex intentionally exposes pending in the UI before the
      // worker reads the existing fingerprint.
      indexStatus: "pending", ...fingerprint,
    })
    await runLibraryIndexJob("job-1", "user-1", "doc-1")
    expect(mocks.withHeartbeat).toHaveBeenCalledWith("job-1", expect.any(Function), expect.objectContaining({ leaseMs: expect.any(Number) }))
    expect(mocks.index).not.toHaveBeenCalled()
    expect(mocks.updateDocument).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { indexStatus: "ready", indexError: null },
    })
    expect(mocks.completeJob).toHaveBeenCalledWith("job-1", expect.objectContaining({ final: "Library index already current" }))
  })

  it("runs an incremental rebuild when the file fingerprint changed", async () => {
    mocks.findDocument.mockResolvedValue({
      id: "doc-1", userId: "user-1", title: "paper.txt", fileType: "text/plain", fileUrl: "object://paper",
      indexStatus: "ready", fileHash: "old", parserVersion: "layout-v2", chunkVersion: "semantic-v2", embeddingModelVersion: null,
    })
    mocks.index.mockResolvedValue({ status: "ready", chunks: [], embeddingStatus: "unavailable" })
    await runLibraryIndexJob("job-1", "user-1", "doc-1")
    expect(mocks.index).toHaveBeenCalledTimes(1)
    expect(mocks.completeJob).toHaveBeenCalled()
  })

  it("does no work when another request already owns the index lease", async () => {
    mocks.claimJob.mockResolvedValueOnce(false)
    await runLibraryIndexJob("job-1", "user-1", "doc-1")
    expect(mocks.findDocument).not.toHaveBeenCalled()
    expect(mocks.index).not.toHaveBeenCalled()
  })
})
