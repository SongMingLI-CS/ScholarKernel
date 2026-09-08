import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const prismaMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findFirst: vi.fn(),
}))

vi.mock("@/lib/auth-user", () => ({ resolveUserIdFromRequest: vi.fn(async () => "user-1") }))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      create: prismaMocks.create,
      update: prismaMocks.update,
      delete: prismaMocks.delete,
      findMany: vi.fn(),
      findFirst: prismaMocks.findFirst,
    },
  },
}))
vi.mock("@/lib/library-index-job", () => ({ scheduleLibraryIndexJob: vi.fn(async () => "index-job-1") }))

import { PATCH, POST } from "../route"
import { setLibraryObjectStorageForTests, type LibraryObjectStorage } from "@/lib/library-storage"

function uploadRequest() {
  const form = new FormData()
  form.append("file", new File(["paper body"], "paper.txt", { type: "text/plain" }))
  return new Request("http://localhost/api/documents", { method: "POST", body: form })
}

describe("POST /api/documents object storage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.create.mockResolvedValue({ id: "doc-1" })
    prismaMocks.update.mockImplementation(async ({ data }) => ({
      id: "doc-1",
      userId: "user-1",
      title: "paper",
      fileUrl: data.fileUrl,
      fileSize: 10,
      fileType: "text/plain",
      tags: [],
      folders: [],
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
    }))
    prismaMocks.delete.mockResolvedValue({})
  })

  afterEach(() => setLibraryObjectStorageForTests(undefined))

  it("persists an object reference instead of a local file path", async () => {
    const storage: LibraryObjectStorage = {
      put: vi.fn(async ({ key }) => ({ key })),
      get: vi.fn(),
      delete: vi.fn(),
    }
    setLibraryObjectStorageForTests(storage)

    const res = await POST(uploadRequest())
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.fileUrl).toMatch(/^object:\/\//)
    expect(json.fileUrl).not.toContain("file://")
    expect(prismaMocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { fileUrl: expect.stringMatching(/^object:\/\//) } })
    )
  })

  it("removes the pending database row when object storage is unavailable", async () => {
    setLibraryObjectStorageForTests(null)
    const res = await POST(uploadRequest())
    expect(res.status).toBe(503)
    expect(prismaMocks.delete).toHaveBeenCalledWith({ where: { id: "doc-1" } })
    expect(prismaMocks.update).not.toHaveBeenCalled()
  })
})

describe("PATCH /api/documents incremental reindex", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const document = {
      id: "doc-1", userId: "user-1", title: "paper", fileUrl: "object://paper",
      fileSize: 10, fileType: "text/plain", tags: [], folders: [],
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
    }
    prismaMocks.findFirst.mockResolvedValue(document)
    prismaMocks.update.mockResolvedValue(document)
  })

  it("schedules the existing document through the same durable index job", async () => {
    const req = new Request("http://localhost/api/documents", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "doc-1", reindex: true }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: "doc-1", indexJobId: "index-job-1", indexStatus: "pending" })
  })
})
