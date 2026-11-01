
import { appPath } from "@/lib/app-path"
/** 浏览器端 API 请求封装：统一 JSON 解析与 401 会话过期通知 */
export class ApiUnauthorizedError extends Error {
  readonly status = 401

  constructor(message = "Unauthorized") {
    super(message)
    this.name = "ApiUnauthorizedError"
  }
}

export function isApiUnauthorizedError(error: unknown): error is ApiUnauthorizedError {
  return error instanceof ApiUnauthorizedError
}

let sessionExpiredNotified = false

const SESSION_EXPIRED_REDIRECT_MS = 1200

/**
 * 登录后回跳目标必须落在站内。
 *
 * 只判 `startsWith("/") && !startsWith("//")` 是不够的：WHATWG URL 解析会把
 * 反斜杠与制表符当作路径分隔符，`/\evil.com`、`/\t/evil.com` 都会解析成
 * `https://evil.com/`，而它们都以单个 `/` 开头 —— 检查通过，人被送去站外。
 *
 * 所以按 origin 比对，并额外拒绝归一化后以 `//` 开头的路径
 * （`/..//evil.com` 归一化后就是 `//evil.com`，交给路由仍是协议相对地址）。
 */
export function resolveSafeCallbackPath(raw: string | null | undefined, origin: string): string {
  if (!raw) return "/"
  try {
    const base = new URL(origin)
    const target = new URL(raw, base)
    if (target.origin !== base.origin) return "/"
    const path = `${target.pathname}${target.search}${target.hash}`
    if (!path.startsWith("/") || path.startsWith("//")) return "/"
    return path
  } catch {
    return "/"
  }
}

/** 构造 session 过期后的登录重定向 URL；已在 /login 时返回 null */
export function buildLoginRedirectUrl(origin: string, pathname: string, search = ""): string | null {
  if (pathname === appPath("/login")) return null
  const callback = `${pathname}${search}`
  const login = new URL(appPath("/login"), origin)
  if (callback && callback !== "/login") {
    login.searchParams.set("callbackUrl", callback)
  }
  return login.toString()
}

/** 延迟跳转到 /login?callbackUrl=…，给 Toast 留出展示时间 */
export function redirectToLoginAfterSessionExpired(delayMs = SESSION_EXPIRED_REDIRECT_MS) {
  if (typeof window === "undefined") return
  const url = buildLoginRedirectUrl(window.location.origin, window.location.pathname, window.location.search)
  if (!url) return
  window.setTimeout(() => {
    window.location.assign(url)
  }, delayMs)
}

/** 通知 LoginGate 重新校验会话，弹出 Toast，并硬重定向到登录页（仅浏览器、每页一次） */
export function notifySessionExpired() {
  if (typeof window === "undefined") return
  if (sessionExpiredNotified) return
  sessionExpiredNotified = true
  window.dispatchEvent(new CustomEvent("sk:session-expired"))
  redirectToLoginAfterSessionExpired()
  window.setTimeout(() => {
    sessionExpiredNotified = false
  }, 4000)
}

export async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(typeof input === "string" ? appPath(input) : input, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })

  if (res.status === 401) {
    notifySessionExpired()
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiUnauthorizedError(err?.error ?? "Unauthorized")
  }

  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(err?.error ?? `HTTP ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}
