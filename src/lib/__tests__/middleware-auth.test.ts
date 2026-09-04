import { describe, expect, it } from "vitest"

import {
  MIDDLEWARE_MATCHER,
  isAuthRequiredInMiddleware,
  isProtectedApiPath,
  isProtectedPagePath,
  isPublicPath,
  unauthorizedJsonBody,
} from "@/lib/middleware-auth"

describe("middleware-auth", () => {
  it("classifies public auth and health routes", () => {
    expect(isPublicPath("/api/auth/session")).toBe(true)
    expect(isPublicPath("/api/auth/login")).toBe(true)
    expect(isPublicPath("/api/health")).toBe(true)
    expect(isPublicPath("/login")).toBe(true)
    expect(isPublicPath("/")).toBe(true)
    expect(isPublicPath("/share/abc-token")).toBe(true)
    expect(isPublicPath("/api/public/share/abc-token")).toBe(true)
  })

  it("classifies protected API prefixes", () => {
    expect(isProtectedApiPath("/api/conversations")).toBe(true)
    expect(isProtectedApiPath("/api/conversations/abc/messages")).toBe(true)
    expect(isProtectedApiPath("/api/agent/run")).toBe(true)
    expect(isProtectedApiPath("/api/agent/jobs/1")).toBe(true)
    expect(isProtectedApiPath("/api/canvas/export")).toBe(true)
    expect(isProtectedApiPath("/api/source")).toBe(true)
    expect(isProtectedApiPath("/api/settings")).toBe(false)
    expect(isProtectedApiPath("/api/proxy/openai")).toBe(false)
  })

  it("classifies protected workspace pages", () => {
    expect(isProtectedPagePath("/dashboard")).toBe(true)
    expect(isProtectedPagePath("/workspace")).toBe(true)
    expect(isProtectedPagePath("/workspace/docs")).toBe(true)
    expect(isProtectedPagePath("/")).toBe(false)
    expect(isProtectedPagePath("/login")).toBe(false)
  })

  it("requires auth only when AUTH_PASSWORD is set and path is protected", () => {
    expect(isAuthRequiredInMiddleware("/api/conversations", "")).toBe(false)
    expect(isAuthRequiredInMiddleware("/api/conversations", "secret")).toBe(true)
    expect(isAuthRequiredInMiddleware("/api/health", "secret")).toBe(false)
    expect(isAuthRequiredInMiddleware("/dashboard", "secret")).toBe(true)
  })

  it("returns standard unauthorized JSON shape", () => {
    expect(unauthorizedJsonBody).toEqual({ error: "Unauthorized", status: 401 })
  })

  it("matcher only lists protected API and workspace paths", () => {
    expect(MIDDLEWARE_MATCHER).toEqual([
      "/api/conversations/:path*",
      "/api/agent/:path*",
      "/api/canvas/:path*",
      "/api/source",
      "/api/public/:path*",
      "/dashboard",
      "/dashboard/:path*",
      "/workspace",
      "/workspace/:path*",
      "/share/:path*",
    ])
    expect(MIDDLEWARE_MATCHER.join(" ")).not.toContain("_next")
  })
})
