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
  if (stored.v !== 1) throw new Error("UnsupportedCipherVersion")
  if (stored.algo !== "AES-256-GCM") throw new Error("UnsupportedCipherAlgo")
  if (stored.kdf !== "PBKDF2" || stored.hash !== "SHA-256") throw new Error("UnsupportedKdf")

  const crypto = requireWebCrypto()
  const salt = b64Decode(stored.salt_b64)
  const nonce = b64Decode(stored.nonce_b64)
  const ct = b64Decode(stored.ct_b64)

  const key = await deriveAesKey(masterPassword, salt, stored.iterations)
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(nonce) },
    key,
    ct
  )
  return bytesToUtf8(pt)
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

