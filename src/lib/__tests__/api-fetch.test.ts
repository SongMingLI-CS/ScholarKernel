import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiUnauthorizedError, apiFetch, buildLoginRedirectUrl, isApiUnauthorizedError, notifySessionExpired } from "@/lib/api-fetch"

describe("api-fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("throws ApiUnauthorizedError and notifies on 401", async () => {
    const dispatch = vi.fn()
    const assign = vi.fn()
    vi.stubGlobal("window", {
      dispatchEvent: dispatch,
      setTimeout: vi.fn((fn: () => void) => {
        fn()
        return 0
      }),
      location: { origin: "http://localhost:3000", pathname: "/workspace", search: "", assign },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }))
    )

    let caught: unknown
    try {
      await apiFetch("/api/conversations")
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ApiUnauthorizedError)
    expect(isApiUnauthorizedError(caught)).toBe(true)
    expect(dispatch).toHaveBeenCalled()
  })

  it("returns parsed JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    )
    await expect(apiFetch<{ ok: boolean }>("/api/test")).resolves.toEqual({ ok: true })
  })

  it("notifySessionExpired is a no-op without window", () => {
    const prev = globalThis.window
    // @ts-expect-error test shim
    delete globalThis.window
    expect(() => notifySessionExpired()).not.toThrow()
    globalThis.window = prev
  })

  it("buildLoginRedirectUrl encodes callbackUrl and skips /login", () => {
    expect(buildLoginRedirectUrl("http://localhost:3000", "/login")).toBeNull()
    const url = buildLoginRedirectUrl("http://localhost:3000", "/workspace", "?c=abc")
    expect(url).toContain("/login")
    expect(url).toContain("callbackUrl")
    expect(decodeURIComponent(url!.split("callbackUrl=")[1] ?? "")).toBe("/workspace?c=abc")
  })
})
