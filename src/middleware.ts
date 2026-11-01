
import { appPath } from "@/lib/app-path"
import { type NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"

import {
  isAuthEnabledInMiddleware,
  isProtectedPath,
  isPublicPath,
  unauthorizedJsonBody,
} from "@/lib/middleware-auth"

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
  if (!isAuthEnabledInMiddleware()) {
    return NextResponse.next()
  }

  const { pathname } = req.nextUrl
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

  const login = new URL(appPath("/login"), req.nextUrl.origin)
  const callback = `${pathname}${req.nextUrl.search}`
  if (callback && callback !== "/login") {
    login.searchParams.set("callbackUrl", callback)
  }
  return NextResponse.redirect(login)
}

export const config = {
  // `/api/:path*` 让中间件覆盖全部 API —— 具体哪些是公开的由
  // `isPublicPath()` 判定（`/api/auth/*`、`/api/health`），其余默认要求登录。
  matcher: [
    "/api/:path*",
    "/dashboard",
    "/dashboard/:path*",
    "/workspace",
    "/workspace/:path*",
  ],
}
