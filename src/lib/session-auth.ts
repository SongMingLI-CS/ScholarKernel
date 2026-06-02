import { createHmac, timingSafeEqual } from "node:crypto"

export const AUTH_SESSION_COOKIE = "sk_session"
export const AUTHENTICATED_USER_ID = "primary_user"
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function readAuthPassword(): string | undefined {
  const raw = process.env.AUTH_PASSWORD
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0 ? trimmed : undefined
}

function readSessionSecret(): string | undefined {
  const raw = process.env.AUTH_SESSION_SECRET ?? process.env.ENCRYPTION_SECRET
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0 ? trimmed : undefined
}

function readAuthenticatedUserId(): string {
  const raw = process.env.AUTH_USER_ID
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0 ? trimmed : AUTHENTICATED_USER_ID
}

export function isAuthEnabled(): boolean {
  return Boolean(readAuthPassword())
}

function assertSessionSecretConfigured() {
  if (!readSessionSecret()) {
    throw new Error("Missing AUTH_SESSION_SECRET (or ENCRYPTION_SECRET) for session signing")
  }
}

function b64urlEncode(input: string) {
  return Buffer.from(input, "utf8").toString("base64url")
}

function b64urlDecode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8")
}

function signPayload(payloadB64: string): string {
  assertSessionSecretConfigured()
  const secret = readSessionSecret()!
  return createHmac("sha256", secret).update(payloadB64).digest("base64url")
}

export function createSessionToken(userId: string, issuedAtMs = Date.now()): string {
  assertSessionSecretConfigured()
  const payload = {
    userId,
    exp: issuedAtMs + SESSION_TTL_MS,
  }
  const payloadB64 = b64urlEncode(JSON.stringify(payload))
  const sig = signPayload(payloadB64)
  return `${payloadB64}.${sig}`
}

export function verifySessionToken(token: string, nowMs = Date.now()): { userId: string } | null {
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [payloadB64, sig] = parts
  if (!payloadB64 || !sig) return null

  const expected = signPayload(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const payload = JSON.parse(b64urlDecode(payloadB64)) as { userId?: string; exp?: number }
    if (!payload.userId || typeof payload.exp !== "number") return null
    if (payload.exp <= nowMs) return null
    return { userId: payload.userId }
  } catch {
    return null
  }
}

export function verifyPassword(password: string): boolean {
  const configured = readAuthPassword()
  if (!configured) return false
  const a = Buffer.from(configured)
  const b = Buffer.from(password)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function readSessionTokenFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie")
  if (!cookie) return null
  for (const part of cookie.split(";")) {
    const trimmed = part.trim()
    if (!trimmed.startsWith(`${AUTH_SESSION_COOKIE}=`)) continue
    const raw = trimmed.slice(AUTH_SESSION_COOKIE.length + 1)
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}

export function resolveSessionUserIdFromRequest(req: Request): string | null {
  const token = readSessionTokenFromRequest(req)
  if (!token) return null
  const session = verifySessionToken(token)
  return session?.userId ?? null
}

export function buildSessionSetCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${AUTH_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
}

export function buildSessionClearCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : ""
  return `${AUTH_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export function createAuthenticatedSessionToken(): string {
  return createSessionToken(readAuthenticatedUserId())
}

export async function hasValidAuthSession(_req?: Request): Promise<boolean> {
  if (!isAuthEnabled()) return false
  const { auth } = await import("@/auth")
  const session = await auth()
  return Boolean(session?.user?.id)
}

/** @deprecated use hasValidAuthSession */
export async function isValidSessionRequest(req: Request): Promise<boolean> {
  return hasValidAuthSession(req)
}
