import { afterEach, describe, expect, it, vi } from "vitest"

import {
  LibraryStorageNotConfiguredError,
  deleteStoredLibraryObject,
  readStoredLibraryObject,
  setLibraryObjectStorageForTests,
  storeLibraryObject,
  type LibraryObjectStorage,
} from "@/lib/library-storage"

describe("Library object storage", () => {
  afterEach(() => setLibraryObjectStorageForTests(undefined))

  it("stores new uploads as provider-neutral object references", async () => {
    const put = vi.fn(async () => ({ key: "users/u1/documents/d1/paper.pdf" }))
    const storage: LibraryObjectStorage = {
      put,
      get: vi.fn(async () => Buffer.from("paper")),
      delete: vi.fn(async () => undefined),
    }
    setLibraryObjectStorageForTests(storage)

    const ref = await storeLibraryObject({
      userId: "u1",
      documentId: "d1",
      filename: "paper.pdf",
      contentType: "application/pdf",
      data: Buffer.from("paper"),
    })

    expect(ref).toBe("object://users/u1/documents/d1/paper.pdf")
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ key: "users/u1/documents/d1/paper.pdf" }))
    expect(ref.startsWith("file://")).toBe(false)
  })

  it("reads and deletes object references through the configured adapter", async () => {
    const storage: LibraryObjectStorage = {
      put: vi.fn(),
      get: vi.fn(async (key) => Buffer.from(`content:${key}`)),
      delete: vi.fn(async () => undefined),
    }
    setLibraryObjectStorageForTests(storage)

    await expect(readStoredLibraryObject("object://users/u1/documents/d1/a.txt")).resolves.toEqual(
      Buffer.from("content:users/u1/documents/d1/a.txt")
    )
    await deleteStoredLibraryObject("object://users/u1/documents/d1/a.txt")
    expect(storage.delete).toHaveBeenCalledWith("users/u1/documents/d1/a.txt")
  })

  it("fails closed when new uploads have no object-store credentials", async () => {
    setLibraryObjectStorageForTests(null)
    await expect(
      storeLibraryObject({
        userId: "u1",
        documentId: "d1",
        filename: "a.txt",
        contentType: "text/plain",
        data: Buffer.from("a"),
      })
    ).rejects.toBeInstanceOf(LibraryStorageNotConfiguredError)
  })
})
