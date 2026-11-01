import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"

const ALGO = "aes-256-gcm" as const
const IV_LEN = 12
const KEY_LEN = 32
const KEY_SALT = "scholarkernel-runtime-keys"

/**
 * 派生密钥缓存，键为 secret 字符串本身。
 *
 * scrypt 是**故意**慢的 KDF，但它的输入在整个进程生命周期里是常量
 * （`ENCRYPTION_SECRET` 不会在运行时变）。不缓存的话每一轮
 * 「解密 → 修改 → 加密」都要付两遍 KDF，而 `scryptSync` 还是同步的 ——
 * 实测单次 ≈ 39.4 ms 且额外分配约 16 MiB，`GET /api/settings` 等于
 * 白等 39 ms，`PATCH` 约 79 ms，同时把事件循环按住不放。
 *
 * 键用 secret 本身而不是「是否已缓存」的布尔量：测试与密钥轮换会改环境变量，
 * 换了 secret 就必须重新派生，否则会用旧密钥去解新密文。
 */
const KEY_CACHE_MAX_ENTRIES = 8
const derivedKeyCache = new Map<string, Buffer>()

/** Dev-only fallback; never used when NODE_ENV=production. */
export const DEV_FALLBACK_ENCRYPTION_SECRET = "scholarkernel-dev-secret"

type EncryptedBlob = {
  iv: string
  tag: string
  data: string
}

function isProductionEnv() {
  return process.env.NODE_ENV === "production"
}

function readSecretFromEnv(): string | undefined {
  const raw = process.env.ENCRYPTION_SECRET ?? process.env.DATABASE_ENCRYPTION_KEY
  const trimmed = typeof raw === "string" ? raw.trim() : ""
  return trimmed.length > 0 ? trimmed : undefined
}

/** Resolve runtime encryption secret; throws in production if unset. */
export function resolveEncryptionSecret(): string {
  const fromEnv = readSecretFromEnv()
  if (fromEnv) return fromEnv
  if (isProductionEnv()) {
    throw new Error(
      "Missing ENCRYPTION_SECRET (or DATABASE_ENCRYPTION_KEY): required in production to encrypt runtime API keys at rest."
    )
  }
  return DEV_FALLBACK_ENCRYPTION_SECRET
}

/** Call during server startup to fail fast in production without a secret. */
export function assertEncryptionSecretForProduction(): void {
  if (!isProductionEnv()) return
  resolveEncryptionSecret()
}

function deriveKey(): Buffer {
  const secret = resolveEncryptionSecret()
  const cached = derivedKeyCache.get(secret)
  if (cached) return cached

  const derived = scryptSync(secret, KEY_SALT, KEY_LEN)
  // 正常只有 1 个 secret；设上限是为了避免「运行时反复换 secret」把内存拖成无界
  if (derivedKeyCache.size >= KEY_CACHE_MAX_ENTRIES) derivedKeyCache.clear()
  derivedKeyCache.set(secret, derived)
  return derived
}

/** AES-256-GCM encrypt plaintext for database persistence */
export function encryptForStorage(plaintext: string): string {
  const key = deriveKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  const blob: EncryptedBlob = {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: encrypted.toString("base64"),
  }
  return JSON.stringify(blob)
}

/** AES-256-GCM decrypt database ciphertext */
export function decryptFromStorage(stored: string): string {
  let blob: EncryptedBlob
  try {
    blob = JSON.parse(stored) as EncryptedBlob
  } catch {
    throw new Error("InvalidEncryptedPayload")
  }
  if (!blob.iv || !blob.tag || !blob.data) throw new Error("InvalidEncryptedPayload")

  const key = deriveKey()
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, "base64"))
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(),
  ])
  return decrypted.toString("utf8")
}
