import { beforeEach, describe, expect, it, vi } from "vitest"

const cryptoCalls = vi.hoisted(() => ({ scrypt: 0 }))

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>()
  return {
    ...actual,
    scryptSync: (secret: unknown, salt: unknown, len: number) => {
      cryptoCalls.scrypt += 1
      return actual.scryptSync(secret as string, salt as string, len)
    },
  }
})

const { encryptForStorage, decryptFromStorage } = await import("@/lib/crypto-server")

/**
 * `deriveKey()` 原来每次加解密都跑一遍 `scryptSync`。
 *
 * scrypt 是**故意**慢的 KDF（这就是它的用途），但密钥派生的输入在整个进程
 * 生命周期里是常量：`ENCRYPTION_SECRET` 不会在运行时变。于是每一轮
 * 「解密 → 修改 → 加密」都要付两遍 KDF 的代价，而且 `scryptSync` 是同步的，
 * 会把事件循环按住不放。
 *
 * 实测（本机 node v22.22.2）：单次 scryptSync(N=16384,r=8,p=1) ≈ 39.4 ms，
 * 每次调用额外分配约 16 MiB。`GET /api/settings` 解一次密钥 = 39 ms 空转，
 * `PATCH /api/settings` = 约 79 ms。
 */

const ORIGINAL_SECRET = process.env.ENCRYPTION_SECRET

describe("加密密钥派生：同一 secret 只派生一次", () => {
  beforeEach(() => {
    cryptoCalls.scrypt = 0
  })

  it("连续 5 轮加密 + 解密只应触发 1 次 scryptSync", () => {
    for (let i = 0; i < 5; i++) {
      const blob = encryptForStorage(JSON.stringify({ deepseek: `sk-${i}` }))
      expect(JSON.parse(decryptFromStorage(blob) as string)).toEqual({ deepseek: `sk-${i}` })
    }
    // 修复前是 10 次（每轮 encrypt 一次 + decrypt 一次）
    expect(cryptoCalls.scrypt).toBe(1)
  })

  it("换 secret 必须重新派生（缓存不能跨密钥复用）", () => {
    const blob = encryptForStorage("plaintext-under-secret-a")
    const before = cryptoCalls.scrypt

    process.env.ENCRYPTION_SECRET = "a-totally-different-secret"
    try {
      expect(cryptoCalls.scrypt).toBe(before)
      expect(() => decryptFromStorage(blob as string)).toThrow()
      expect(cryptoCalls.scrypt).toBe(before + 1)

      const blobB = encryptForStorage("plaintext-under-secret-b")
      expect(decryptFromStorage(blobB)).toBe("plaintext-under-secret-b")
      expect(cryptoCalls.scrypt).toBe(before + 1)
    } finally {
      if (ORIGINAL_SECRET === undefined) delete process.env.ENCRYPTION_SECRET
      else process.env.ENCRYPTION_SECRET = ORIGINAL_SECRET
    }
  })

  it("篡改 auth tag 会被 GCM 拒绝", () => {
    const blob = JSON.parse(encryptForStorage("secret-value"))
    const tag = Buffer.from(blob.tag, "base64")
    tag[0] = tag[0] === 0 ? 1 : 0
    blob.tag = tag.toString("base64")
    expect(() => decryptFromStorage(JSON.stringify(blob))).toThrow()
  })
})
