/**
 * Edge-safe route policy for NextAuth middleware (no Prisma imports).
 */

export const unauthorizedJsonBody = { error: "Unauthorized", status: 401 } as const

const PUBLIC_API_EXACT = new Set(["/api/health"])
const PUBLIC_API_PREFIXES = ["/api/auth/"] as const
const PUBLIC_PAGES = new Set(["/", "/login"])

const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/workspace"] as const

export function isAuthEnabledInMiddleware(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.AUTH_PASSWORD
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0
}

function isPublicApiPath(pathname: string): boolean {
  if (PUBLIC_API_EXACT.has(pathname)) return true
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGES.has(pathname)) return true
  return isPublicApiPath(pathname)
}

/**
 * API 侧改为「默认受保护，白名单放行」。
 *
 * 原实现枚举三个前缀（conversations / agent / canvas），新增的接口只要忘了登记
 * 就是默认公开的 —— `/api/source` 就是这样漏出去的：它不在列表里、自身也没有
 * 任何鉴权，`?path=.env` 可以直接读到应用根目录的环境变量文件。
 * 接口的默认状态必须是「受保护」，公开要显式申请。
 */
export function isProtectedApiPath(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false
  return !isPublicApiPath(pathname)
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
  "/api/:path*",
  "/dashboard",
  "/dashboard/:path*",
  "/workspace",
  "/workspace/:path*",
] as const
