import { jsonError } from "@/lib/api-utils"
import {
  checkProxyAuth,
  checkRateLimit,
  isKnownProxyProvider,
  logProxyRequest,
  resolveClientIp,
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
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer()
  }

  let upstreamRes: Response
  try {
    upstreamRes = await fetch(url.toString(), init)
  } catch (e) {
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

  return new Response(upstreamRes.body, {
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
