import { describe, expect, it } from "vitest"

import { isUsableApiKey, sanitizeRuntimeKeys, mergeRuntimeKeysUpdate, EMPTY_RUNTIME_KEYS } from "@/store/runtime-keys"

describe("runtime-keys", () => {
  it("rejects dummy keys", () => {
    expect(isUsableApiKey("dummy-key")).toBe(false)
    expect(isUsableApiKey("sk-test-abc")).toBe(false)
  })

  it("sanitizeRuntimeKeys clears invalid fields", () => {
    const out = sanitizeRuntimeKeys({ ...EMPTY_RUNTIME_KEYS, openai: "dummy" })
    expect(out).toBeNull()
  })

  it("mergeRuntimeKeysUpdate keeps valid existing when incoming invalid", () => {
    const existing = { ...EMPTY_RUNTIME_KEYS, openai: "sk-validkey123456789" }
    const merged = mergeRuntimeKeysUpdate(existing, { openai: "dummy" })
    expect(merged?.openai).toBe("sk-validkey123456789")
  })
})
