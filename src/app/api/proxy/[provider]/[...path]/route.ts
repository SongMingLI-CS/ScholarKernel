import { jsonError } from "@/lib/api-utils"
import {
  ProxyBodyTooLargeError,
  capUpstreamResponseStream,
  checkProxyAuth,
  checkRateLimit,
  isKnownProxyProvider,
  logProxyRequest,
  readBoundedRequestBody,
  readUpstreamDeclaredContentLength,
  resolveClientIp,
  resolveProxyMaxResponseBytes,
  resolveProxyUpstreamTimeoutMs,
  resolveProxyUpstreamUrl,
} from "@/lib/proxy-gateway"

type RouteCtx = { params: Promise<{ provider: string; path: string[] }> }

const FORWARD_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "anthropic-version",
  "x-api-key",
  "openai-beta",
] as const

async function handleProxy(req: Request, ctx: RouteCtx) {
  const { provider, path } = await ctx.params
  const pathSegments = path ?? []

  if (!isKnownProxyProvider(provider)) {
    return jsonError("Unknown proxy provider", 404)
  }

  const authResult = await checkProxyAuth(req)
  if (!authResult.ok) return jsonError(authResult.message, authResult.status)

  const clientIp = resolveClientIp(req)
  const rate = checkRateLimit(clientIp)
  if (!rate.ok) return jsonError(rate.message, rate.status)

  const upstreamUrl = resolveProxyUpstreamUrl(provider, pathSegments)
  if (!upstreamUrl) return jsonError("Invalid proxy path", 400)

  const url = new URL(upstreamUrl)
  const incoming = new URL(req.url)
  incoming.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  const headers = new Headers()
  for (const name of FORWARD_HEADERS) {
    const value = req.headers.get(name)
    if (value) headers.set(name, value)
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(resolveProxyUpstreamTimeoutMs()),
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      init.body = await readBoundedRequestBody(req)
    } catch (e) {
      if (e instanceof ProxyBodyTooLargeError) {
        logProxyRequest({ provider, path: pathSegments.join("/"), status: 413, clientIp })
        return jsonError("Proxy request body too large", 413)
      }
      throw e
    }
  }

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(url.toString(), init)
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
    if (timedOut) {
      // 上游既不返回也不断开时，不能让请求永久悬挂
      console.error("[proxy] upstream timeout", provider)
      logProxyRequest({ provider, path: pathSegments.join("/"), status: 504, clientIp })
      return jsonError("Upstream proxy request timed out", 504)
    }
    console.error("[proxy] upstream fetch failed", e)
    logProxyRequest({ provider, path: pathSegments.join("/"), status: 502, clientIp })
    return jsonError("Upstream proxy request failed", 502)
  }

  logProxyRequest({
    provider,
    path: pathSegments.join("/"),
    status: upstreamRes.status,
    clientIp,
  })

  const resHeaders = new Headers()
  const contentType = upstreamRes.headers.get("content-type")
  if (contentType) resHeaders.set("content-type", contentType)
  const cacheControl = upstreamRes.headers.get("cache-control")
  if (cacheControl) resHeaders.set("cache-control", cacheControl)
  // 同源响应必须带 nosniff：这个路由是 /api/proxy/...，与主应用同源，
  // 上游若返回 text/html，浏览器会按 content-type 嗅探并当成 HTML 渲染 ——
  // 等于把上游内容注入主应用_origin。nosniff 强制按声明类型处理。
  resHeaders.set("x-content-type-options", "nosniff")

  // 响应体上限：先看 content-length 给干净的 413（声明值可伪造，只用于提前失败）；
  // 再给 body 套计数外壳，越界在中途 abort。两个一起才能同时挡住「老实的大响应」
  // 和「撒谎的大响应」。
  const maxResponseBytes = resolveProxyMaxResponseBytes()
  const declared = readUpstreamDeclaredContentLength(upstreamRes)
  if (Number.isFinite(declared) && declared > maxResponseBytes) {
    logProxyRequest({ provider, path: pathSegments.join("/"), status: 413, clientIp })
    // 不消费上游 body：让它自己断开
    upstreamRes.body?.cancel().catch(() => undefined)
    return jsonError("Proxy response too large", 413)
  }

  const body = upstreamRes.body
    ? capUpstreamResponseStream(upstreamRes.body, maxResponseBytes)
    : null

  return new Response(body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: resHeaders,
  })
}

export async function GET(req: Request, ctx: RouteCtx) {
  return handleProxy(req, ctx)
}

export async function POST(req: Request, ctx: RouteCtx) {
  return handleProxy(req, ctx)
}

export async function PUT(req: Request, ctx: RouteCtx) {
  return handleProxy(req, ctx)
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  return handleProxy(req, ctx)
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  return handleProxy(req, ctx)
}

export async function OPTIONS(req: Request, ctx: RouteCtx) {
  return handleProxy(req, ctx)
}
