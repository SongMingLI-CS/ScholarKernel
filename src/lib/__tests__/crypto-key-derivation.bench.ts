import { createDecipheriv, scryptSync } from "node:crypto"

import { bench, describe } from "vitest"

import { decryptFromStorage, encryptForStorage } from "@/lib/crypto-server"

/**
 * 密钥派生缓存的 A/B 基线。
 *
 * 这条链路是「设置页每次打开都会跑」的热路径：`GET /api/settings` 解一次密钥，
 * `PATCH` 解一次 + 加一次。scrypt 被设计成慢的，但它的输入在进程内是常量，
 * 每轮重算属于纯浪费 —— 而且 `scryptSync` 同步占住事件循环。
 *
 * 运行：npx vitest bench --run
 */

const SALT = "scholarkernel-runtime-keys"
const KEY_LEN = 32
const ALGO = "aes-256-gcm"

const PLAINTEXT = JSON.stringify({
  openai: "sk-proj-0123456789abcdef",
  deepseek: "sk-0123456789abcdef",
  tavily: "tvly-dev-0123456789abcdef",
})

const STORED = encryptForStorage(PLAINTEXT)
const blob = JSON.parse(STORED) as { iv: string; tag: string; data: string }

/** 修复前的实现：每次解密都重新派生。 */
function decryptWithoutCache(secret: string): string {
  const key = scryptSync(secret, SALT, KEY_LEN)
  const decipher = createDecipheriv(ALGO, key, Buffer.from(blob.iv, "base64"))
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(blob.data, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

describe("解密一条已加密的 runtimeKeys", () => {
  bench("修复前：每次重新 scrypt 派生", () => {
    process.env.ENCRYPTION_SECRET = "scholarkernel-dev-secret"
    decryptWithoutCache("scholarkernel-dev-secret")
  })

  bench("修复后：复用派生的密钥", () => {
    process.env.ENCRYPTION_SECRET = "scholarkernel-dev-secret"
    decryptFromStorage(STORED)
  })
})
