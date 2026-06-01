import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("crypto-server", () => {
  const envSnapshot = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...envSnapshot }
  })

  it("encrypts and decrypts roundtrip with ENCRYPTION_SECRET", async () => {
    process.env.ENCRYPTION_SECRET = "test-secret-key-for-unit-tests"
    delete process.env.DATABASE_ENCRYPTION_KEY
    const { encryptForStorage, decryptFromStorage } = await import("@/lib/crypto-server")
    const plain = JSON.stringify({ openai: "sk-test" })
    const enc = encryptForStorage(plain)
    expect(decryptFromStorage(enc)).toBe(plain)
  })

  it("uses DATABASE_ENCRYPTION_KEY when ENCRYPTION_SECRET is unset", async () => {
    delete process.env.ENCRYPTION_SECRET
    process.env.DATABASE_ENCRYPTION_KEY = "preferred-secret-key-for-tests"
    const mod = await import("@/lib/crypto-server")
    const enc = mod.encryptForStorage("payload-a")
    expect(mod.decryptFromStorage(enc)).toBe("payload-a")
  })

  it("throws in production when encryption secret is missing", async () => {
    process.env.NODE_ENV = "production"
    delete process.env.ENCRYPTION_SECRET
    delete process.env.DATABASE_ENCRYPTION_KEY
    const { assertEncryptionSecretForProduction } = await import("@/lib/crypto-server")
    expect(() => assertEncryptionSecretForProduction()).toThrow(/ENCRYPTION_SECRET/)
  })

  it("resolveEncryptionSecret throws in production when secret is missing", async () => {
    process.env.NODE_ENV = "production"
    delete process.env.ENCRYPTION_SECRET
    delete process.env.DATABASE_ENCRYPTION_KEY
    const { resolveEncryptionSecret } = await import("@/lib/crypto-server")
    expect(() => resolveEncryptionSecret()).toThrow(/ENCRYPTION_SECRET/)
  })

  it("uses dev fallback in non-production when secret is missing", async () => {
    process.env.NODE_ENV = "development"
    delete process.env.ENCRYPTION_SECRET
    delete process.env.DATABASE_ENCRYPTION_KEY
    const { encryptForStorage, decryptFromStorage } = await import("@/lib/crypto-server")
    const enc = encryptForStorage("hello-dev")
    expect(decryptFromStorage(enc)).toBe("hello-dev")
  })

  it("rejects invalid encrypted payload", async () => {
    process.env.ENCRYPTION_SECRET = "test-secret-key-for-unit-tests"
    const { decryptFromStorage } = await import("@/lib/crypto-server")
    expect(() => decryptFromStorage("not-json")).toThrow("InvalidEncryptedPayload")
    expect(() => decryptFromStorage(JSON.stringify({ iv: "", tag: "", data: "" }))).toThrow(
      "InvalidEncryptedPayload"
    )
  })
})
