import { describe, expect, it } from "vitest"

import { isAbortError } from "@/lib/run-abort"

describe("isAbortError", () => {
  it("detects DOMException AbortError", () => {
    const err = new DOMException("The operation was aborted.", "AbortError")
    expect(isAbortError(err)).toBe(true)
  })

  it("detects message containing aborted", () => {
    expect(isAbortError(new Error("Request aborted"))).toBe(true)
  })

  it("returns false for unrelated errors", () => {
    expect(isAbortError(new Error("HTTP 500"))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})
