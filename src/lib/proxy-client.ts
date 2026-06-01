const PROXY_TOKEN_STORAGE_KEY = "sk:proxy-access-token"

export function getStoredProxyAccessToken(): string | null {
  if (typeof window === "undefined") return null
  const value = window.sessionStorage.getItem(PROXY_TOKEN_STORAGE_KEY)
  return value?.trim() ? value.trim() : null
}

export function setStoredProxyAccessToken(token: string | null | undefined) {
  if (typeof window === "undefined") return
  const trimmed = typeof token === "string" ? token.trim() : ""
  if (!trimmed) window.sessionStorage.removeItem(PROXY_TOKEN_STORAGE_KEY)
  else window.sessionStorage.setItem(PROXY_TOKEN_STORAGE_KEY, trimmed)
}

export function isProxyUrl(url: string): boolean {
  return url.includes("/api/proxy/")
}

export function applyProxyAuthHeaders(init?: RequestInit): RequestInit {
  const token = getStoredProxyAccessToken()
  if (!token) return init ?? {}
  const headers = new Headers(init?.headers)
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`)
  }
  return { ...init, headers }
}

/** Same-origin fetch wrapper that attaches proxy access token when configured. */
export function proxyAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : String(input)

  if (isProxyUrl(url)) {
    return fetch(input, applyProxyAuthHeaders(init))
  }
  return fetch(input, init)
}
