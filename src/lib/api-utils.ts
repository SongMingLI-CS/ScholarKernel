import { NextResponse } from "next/server"

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * JSON 请求体上限。
 *
 * Next.js 的 Route Handler 不像 Server Action 那样有内置的体积限制，
 * `await req.json()` 会把整个请求体读进内存 —— 一个几百 MB 的 POST 就能把进程拖死。
 * 8 MiB 足够容纳本应用最大的合法 JSON（画布文档正文、长消息），
 * 又远低于会威胁进程的量级。
 */
export const DEFAULT_MAX_JSON_BODY_BYTES = 8 * 1024 * 1024

function readPositiveIntEnv(name: string): number | null {
  const raw = process.env[name]
  if (typeof raw !== "string") return null
  const n = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function resolveMaxJsonBodyBytes(): number {
  return readPositiveIntEnv("API_MAX_JSON_BODY_BYTES") ?? DEFAULT_MAX_JSON_BODY_BYTES
}

/**
 * 有界读取请求体文本。超限返回 `null`。
 *
 * 先看 `content-length` 做快速拒绝（该头可被伪造，所以只用于提前失败，不作为放行依据），
 * 再边读边累加，越界立即取消剩余读取 —— 与 `proxy-gateway.readBoundedRequestBody` 同一策略。
 * 解码用 `fatal: true`：非法 UTF-8 直接判失败，而不是悄悄替换成 U+FFFD。
 */
export async function readBoundedText(
  req: Request,
  maxBytes = resolveMaxJsonBodyBytes()
): Promise<string | null> {
  const declaredRaw = req.headers.get("content-length")
  const declared = declaredRaw === null ? Number.NaN : Number.parseInt(declaredRaw, 10)
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!req.body) return ""

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // 已取消的 reader 可能不允许重复释放
    }
  }

  const buf = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    buf.set(c, offset)
    offset += c.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

/**
 * 解析 JSON 请求体；体积超限、编码非法、语法错误、空 body 一律返回 `null`。
 * 调用方统一按 400 处理（错误码区分对客户端无意义，重点是**不缓冲**）。
 */
export async function parseJsonBody<T>(
  req: Request,
  maxBytes = resolveMaxJsonBodyBytes()
): Promise<T | null> {
  const text = await readBoundedText(req, maxBytes)
  if (text === null || !text.trim()) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
