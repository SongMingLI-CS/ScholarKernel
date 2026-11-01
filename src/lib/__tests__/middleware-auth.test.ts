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
    expect(isPublicPath("/api/healthcheck")).toBe(false)
    expect(isPublicPath("/login")).toBe(true)
    expect(isPublicPath("/")).toBe(true)
  })

  it("API 默认受保护，只有白名单公开", () => {
    expect(isProtectedApiPath("/api/conversations")).toBe(true)
    expect(isProtectedApiPath("/api/conversations/abc/messages")).toBe(true)
    expect(isProtectedApiPath("/api/agent/run")).toBe(true)
    expect(isProtectedApiPath("/api/agent/jobs/1")).toBe(true)
    expect(isProtectedApiPath("/api/canvas/export")).toBe(true)
    // 新增端点默认受保护：曾因不在枚举列表里而裸奔的 /api/source
    expect(isProtectedApiPath("/api/source")).toBe(true)
    expect(isProtectedApiPath("/api/settings")).toBe(true)
    expect(isProtectedApiPath("/api/user/billing-metrics")).toBe(true)
    expect(isProtectedApiPath("/api/documents/parse")).toBe(true)
    // 代理路由靠自身的 PROXY_ACCESS_TOKEN，但同样先过登录
    expect(isProtectedApiPath("/api/proxy/openai")).toBe(true)
    // 公开白名单
    expect(isProtectedApiPath("/api/auth/session")).toBe(false)
    expect(isProtectedApiPath("/api/health")).toBe(false)
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
    expect(isAuthRequiredInMiddleware("/api/source", "secret")).toBe(true)
    expect(isAuthRequiredInMiddleware("/api/source", "")).toBe(false)
  })

  it("returns standard unauthorized JSON shape", () => {
    expect(unauthorizedJsonBody).toEqual({ error: "Unauthorized", status: 401 })
  })

  it("matcher only lists protected API and workspace paths", () => {
    expect(MIDDLEWARE_MATCHER).toEqual([
      "/api/:path*",
      "/dashboard",
      "/dashboard/:path*",
      "/workspace",
      "/workspace/:path*",
    ])
    expect(MIDDLEWARE_MATCHER.join(" ")).not.toContain("_next")
  })
})
