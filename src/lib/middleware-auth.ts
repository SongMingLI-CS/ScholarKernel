/**
 * Edge-safe route policy for NextAuth middleware (no Prisma imports).
 */

export const unauthorizedJsonBody = { error: "Unauthorized", status: 401 } as const

const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/health"] as const
const PUBLIC_PAGES = new Set(["/", "/login"])

/** Anonymous read-only share surface — must stay unauthenticated. */
const PUBLIC_PAGE_PREFIXES = ["/share/"] as const
const PUBLIC_API_EXTRA_PREFIXES = ["/api/public/"] as const

const PROTECTED_API_PREFIXES = ["/api/conversations", "/api/agent", "/api/canvas", "/api/source"] as const
const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/workspace"] as const

export function isAuthEnabledInMiddleware(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.AUTH_PASSWORD
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0
}

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGES.has(pathname)) return true
  if (PUBLIC_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  if (PUBLIC_API_EXTRA_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix)
  )
}

export function isProtectedApiPath(pathname: string): boolean {
  return PROTECTED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function isProtectedPagePath(pathname: string): boolean {
  return PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export function isProtectedPath(pathname: string): boolean {
  return isProtectedApiPath(pathname) || isProtectedPagePath(pathname)
}

export function isAuthRequiredInMiddleware(
  pathname: string,
  authPassword: string | undefined
): boolean {
  const enabled = typeof authPassword === "string" && authPassword.trim().length > 0
  if (!enabled) return false
  if (isPublicPath(pathname)) return false
  return isProtectedPath(pathname)
}

/** Canonical matcher list (must stay in sync with `src/middleware.ts` `config.matcher`). */
export const MIDDLEWARE_MATCHER = [
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
] as const
