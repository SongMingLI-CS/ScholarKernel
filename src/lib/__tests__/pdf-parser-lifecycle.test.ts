import { beforeEach, describe, expect, it, vi } from "vitest"

const { getDocumentMock } = vi.hoisted(() => ({ getDocumentMock: vi.fn() }))

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: getDocumentMock }))

import { extractPdfFromBuffer } from "@/lib/document/pdf-text-extract"

describe("PDF parser lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("times out and destroys the PDF.js task", async () => {
    const destroy = vi.fn(async () => {})
    getDocumentMock.mockReturnValue({ promise: new Promise(() => {}), destroy })

    await expect(
      extractPdfFromBuffer(Buffer.from("%PDF-1.7"), { timeoutMs: 5 })
    ).rejects.toMatchObject({ code: "PDF_TIMEOUT", status: 408 })

    expect(destroy).toHaveBeenCalledOnce()
  })

  it("gives password-protected PDFs a clear error and destroys the task", async () => {
    const destroy = vi.fn(async () => {})
    const passwordError = Object.assign(new Error("Password required"), {
      name: "PasswordException",
    })
    getDocumentMock.mockReturnValue({ promise: Promise.reject(passwordError), destroy })

    await expect(extractPdfFromBuffer(Buffer.from("%PDF-1.7"))).rejects.toMatchObject({
      code: "PDF_PASSWORD_PROTECTED",
      message: expect.stringContaining("密码保护"),
    })

    expect(destroy).toHaveBeenCalledOnce()
  })

  it("cleans each page and destroys the PDF.js task after success", async () => {
    const cleanup = vi.fn()
    const destroy = vi.fn(async () => {})
    const page = {
      view: [0, 0, 612, 792],
      getViewport: () => ({ width: 612, height: 792 }),
      getTextContent: async () => ({
        items: [
          {
            str: "Lifecycle check",
            transform: [12, 0, 0, 12, 72, 720],
            width: 70,
            height: 12,
            hasEOL: true,
          },
        ],
      }),
      cleanup,
    }
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage: async () => page }),
      destroy,
    })

    const parsed = await extractPdfFromBuffer(Buffer.from("%PDF-1.7"))

    expect(parsed.text).toContain("Lifecycle check")
    expect(cleanup).toHaveBeenCalledOnce()
    expect(destroy).toHaveBeenCalledOnce()
  })
})
