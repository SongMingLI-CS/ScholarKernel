import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto"

const ALGO = "aes-256-gcm" as const
const IV_LEN = 12
const KEY_LEN = 32

type EncryptedBlob = {
  iv: string
  tag: string
  data: string
}

function deriveKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET ?? process.env.DATABASE_ENCRYPTION_KEY ?? "scholarkernel-dev-secret"
  return scryptSync(secret, "scholarkernel-runtime-keys", KEY_LEN)
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
