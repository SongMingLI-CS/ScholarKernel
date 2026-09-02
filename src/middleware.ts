import { type NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"

import {
  isAuthEnabledInMiddleware,
  isProtectedPath,
  isPublicPath,
  unauthorizedJsonBody,
} from "@/lib/middleware-auth"
import {
  buildRateLimitKey,
  checkCoreApiRateLimit,
  isCoreApiWriteRequest,
  rateLimitExceededBody,
  rateLimitResponseHeaders,
  resolveClientIp,
} from "@/lib/ratelimit"

function readAuthSecret(): string | undefined {
  const raw =
    process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SESSION_SECRET ??
    process.env.ENCRYPTION_SECRET
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0 ? trimmed : undefined
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (isCoreApiWriteRequest(pathname, req.method)) {
    const secret = readAuthSecret()
    const token = secret
      ? await getToken({ req, secret, secureCookie: req.nextUrl.protocol === "https:" })
      : null
    const key = buildRateLimitKey(resolveClientIp(req), token?.sub)
    const rate = await checkCoreApiRateLimit(key)
    if (!rate.success) {
      return NextResponse.json(rateLimitExceededBody, {
        status: 429,
        headers: rateLimitResponseHeaders(rate),
      })
    }
  }

  if (!isAuthEnabledInMiddleware()) {
    return NextResponse.next()
  }

  if (isPublicPath(pathname) || !isProtectedPath(pathname)) {
    return NextResponse.next()
  }

  const secret = readAuthSecret()
  const token = secret ? await getToken({ req, secret, secureCookie: req.nextUrl.protocol === "https:" }) : null
  if (token?.sub) {
    return NextResponse.next()
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(unauthorizedJsonBody, { status: 401 })
  }

  const login = new URL("/login", req.nextUrl.origin)
  const callback = `${pathname}${req.nextUrl.search}`
  if (callback && callback !== "/login") {
    login.searchParams.set("callbackUrl", callback)
  }
  return NextResponse.redirect(login)
}

export const config = {
  matcher: [
    "/api/conversations/:path*",
    "/api/agent/:path*",
    "/api/canvas/:path*",
    "/api/public/:path*",
    "/dashboard",
    "/dashboard/:path*",
    "/workspace",
    "/workspace/:path*",
    "/share/:path*",
  ],
}
