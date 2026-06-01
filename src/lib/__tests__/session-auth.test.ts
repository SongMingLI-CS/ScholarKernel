import { afterEach, beforeEach, describe, expect, it } from "vitest"

describe("session-auth", () => {
  const envSnapshot = { ...process.env }

  beforeEach(() => {
    process.env = { ...envSnapshot }
    process.env.AUTH_SESSION_SECRET = "test-session-secret-key"
    process.env.AUTH_PASSWORD = "test-app-password"
    delete process.env.AUTH_USER_ID
  })

  afterEach(() => {
    process.env = { ...envSnapshot }
  })

  it("reports auth disabled when AUTH_PASSWORD is unset", async () => {
    delete process.env.AUTH_PASSWORD
    const mod = await import("@/lib/session-auth")
    expect(mod.isAuthEnabled()).toBe(false)
  })

  it("creates and verifies session token", async () => {
    const mod = await import("@/lib/session-auth")
    const token = mod.createSessionToken("primary_user")
    expect(mod.verifySessionToken(token)).toEqual({ userId: "primary_user" })
  })

  it("rejects tampered session token", async () => {
    const mod = await import("@/lib/session-auth")
    const token = mod.createSessionToken("primary_user")
    const tampered = `${token}x`
    expect(mod.verifySessionToken(tampered)).toBeNull()
  })

  it("rejects expired session token", async () => {
    const mod = await import("@/lib/session-auth")
    const token = mod.createSessionToken("primary_user", Date.now() - 8 * 24 * 60 * 60 * 1000)
    expect(mod.verifySessionToken(token, Date.now())).toBeNull()
  })

  it("verifies configured password", async () => {
    const mod = await import("@/lib/session-auth")
    expect(mod.verifyPassword("test-app-password")).toBe(true)
    expect(mod.verifyPassword("wrong")).toBe(false)
  })

  it("reads session cookie from request", async () => {
    const mod = await import("@/lib/session-auth")
    const token = mod.createSessionToken("primary_user")
    const req = new Request("http://localhost/api/conversations", {
      headers: { Cookie: `sk_session=${encodeURIComponent(token)}` },
    })
    expect(mod.readSessionTokenFromRequest(req)).toBe(token)
  })
})
