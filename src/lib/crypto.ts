export type StoredCipherV1 = {
  v: 1
  algo: "AES-256-GCM"
  kdf: "PBKDF2"
  hash: "SHA-256"
  iterations: number
  salt_b64: string
  nonce_b64: string
  ct_b64: string
}

const PBKDF2_ITERATIONS = 210_000
const SALT_LEN = 16
const NONCE_LEN = 12

/**
 * PBKDF2 迭代次数的可接受区间。
 *
 * 信封是从 localStorage 读出来的，其内容对同源脚本（或被诱导导入的备份）完全可控：
 * - 调低 iterations（例如 1）→ 离线爆破成本归零，等于绕过 KDF；
 * - 调高 iterations（例如 1e12）→ deriveKey 永不返回，页面直接挂死。
 * 两端都必须在进入 WebCrypto 之前拒绝。
 */
export const MIN_PBKDF2_ITERATIONS = 100_000
export const MAX_PBKDF2_ITERATIONS = 2_000_000

function utf8ToBytes(s: string) {
  return new TextEncoder().encode(s)
}

function bytesToUtf8(bytes: ArrayBuffer) {
  return new TextDecoder().decode(bytes)
}

function b64Encode(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes)
  let bin = ""
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]!)
  return btoa(bin)
}

function b64Decode(b64: string) {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8.buffer
}

function requireWebCrypto() {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("WebCryptoUnavailable")
  }
  return window.crypto
}

function randomBytes(len: number) {
  const crypto = requireWebCrypto()
  const u8 = new Uint8Array(len)
  crypto.getRandomValues(u8)
  return u8.buffer
}

async function importPasswordKey(masterPassword: string) {
  const crypto = requireWebCrypto()
  return crypto.subtle.importKey("raw", utf8ToBytes(masterPassword), "PBKDF2", false, [
    "deriveKey",
  ])
}

async function deriveAesKey(masterPassword: string, salt: ArrayBuffer, iterations: number) {
  const crypto = requireWebCrypto()
  const baseKey = await importPasswordKey(masterPassword)
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encryptString(masterPassword: string, plaintext: string): Promise<StoredCipherV1> {
  const crypto = requireWebCrypto()
  const salt = randomBytes(SALT_LEN)
  const nonce = randomBytes(NONCE_LEN)
  const key = await deriveAesKey(masterPassword, salt, PBKDF2_ITERATIONS)

  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) },
    key,
    utf8ToBytes(plaintext)
  )

  return {
    v: 1,
    algo: "AES-256-GCM",
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt_b64: b64Encode(salt),
    nonce_b64: b64Encode(nonce),
    ct_b64: b64Encode(ct),
  }
}

export async function decryptString(masterPassword: string, stored: StoredCipherV1): Promise<string> {
  // 先做纯逻辑校验，任何非法信封都不应进入 WebCrypto（尤其是超大 iterations）
  const { salt, nonce, ct } = parseCipherEnvelope(stored)

  const crypto = requireWebCrypto()
  const key = await deriveAesKey(masterPassword, salt, stored.iterations)
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) },
    key,
    ct
  )
  return bytesToUtf8(pt)
}

function decodeChecked(b64: unknown, minLen: number, maxLen: number, code: string): ArrayBuffer {
  if (typeof b64 !== "string" || !b64) throw new Error(code)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(b64Decode(b64))
  } catch {
    throw new Error(code)
  }
  if (bytes.length < minLen || bytes.length > maxLen) throw new Error(code)
  return bytes.buffer as ArrayBuffer
}

/**
 * 校验信封形状并解码出三个二进制段。
 * 所有字段都来自持久化数据，必须当作不可信输入处理。
 */
export function parseCipherEnvelope(stored: StoredCipherV1): {
  salt: ArrayBuffer
  nonce: ArrayBuffer
  ct: ArrayBuffer
} {
  if (!stored || typeof stored !== "object") throw new Error("InvalidCipherEnvelope")
  if (stored.v !== 1) throw new Error("UnsupportedCipherVersion")
  if (stored.algo !== "AES-256-GCM") throw new Error("UnsupportedCipherAlgo")
  if (stored.kdf !== "PBKDF2" || stored.hash !== "SHA-256") throw new Error("UnsupportedKdf")

  const iterations = stored.iterations
  if (typeof iterations !== "number" || !Number.isInteger(iterations)) {
    throw new Error("InvalidKdfIterations")
  }
  if (iterations < MIN_PBKDF2_ITERATIONS) throw new Error("WeakKdfIterations")
  if (iterations > MAX_PBKDF2_ITERATIONS) throw new Error("ExcessiveKdfIterations")

  const salt = decodeChecked(stored.salt_b64, SALT_LEN, SALT_LEN * 4, "InvalidSalt")
  // AES-GCM 的 nonce 必须与加密时一致，当前实现固定 12 字节
  const nonce = decodeChecked(stored.nonce_b64, NONCE_LEN, NONCE_LEN, "InvalidNonce")
  const ct = decodeChecked(stored.ct_b64, 1, Number.MAX_SAFE_INTEGER, "InvalidCiphertext")

  return { salt, nonce, ct }
}

/** 只校验不解码；给调用方在解密前做快速拒绝用。 */
export function validateCipherEnvelope(stored: StoredCipherV1): void {
  parseCipherEnvelope(stored)
}

const STORAGE_KEY = "sk:keys:v1"

export function hasEncryptedKeysInStorage(): boolean {
  if (typeof window === "undefined") return false
  return typeof window.localStorage.getItem(STORAGE_KEY) === "string"
}

export function loadEncryptedKeysFromStorage(): StoredCipherV1 | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredCipherV1
    if (parsed?.v !== 1) return null
    return parsed
  } catch {
    return null
  }
}

export function saveEncryptedKeysToStorage(cipher: StoredCipherV1) {
  if (typeof window === "undefined") throw new Error("StorageUnavailable")
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cipher))
}

export function clearEncryptedKeysFromStorage() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(STORAGE_KEY)
}

