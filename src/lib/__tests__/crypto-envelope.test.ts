import { afterEach, describe, expect, it, vi } from "vitest"

import {
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  decryptString,
  encryptString,
  validateCipherEnvelope,
  type StoredCipherV1,
} from "../crypto"

function envelope(overrides: Partial<StoredCipherV1> = {}): StoredCipherV1 {
  return {
    v: 1,
    algo: "AES-256-GCM",
    kdf: "PBKDF2",
    hash: "SHA-256",
    iterations: 210_000,
    salt_b64: btoa("0123456789abcdef"),
    nonce_b64: btoa("0123456789ab"),
    ct_b64: btoa("ciphertext"),
    ...overrides,
  }
}

describe("cipher envelope 校验", () => {
  it("接受当前实现产出的信封", () => {
    expect(() => validateCipherEnvelope(envelope())).not.toThrow()
  })

  it("拒绝未知版本与算法", () => {
    expect(() => validateCipherEnvelope(envelope({ v: 2 as unknown as 1 }))).toThrow(/UnsupportedCipherVersion/)
    expect(() => validateCipherEnvelope(envelope({ algo: "AES-CBC" as unknown as "AES-256-GCM" }))).toThrow(
      /UnsupportedCipherAlgo/
    )
    expect(() => validateCipherEnvelope(envelope({ hash: "SHA-1" as unknown as "SHA-256" }))).toThrow(/UnsupportedKdf/)
  })

  it("拒绝过低的迭代次数，防止 KDF 降级", () => {
    // 攻击者把 iterations 改成 1，PBKDF2 几乎不花时间，离线爆破成本归零
    expect(() => validateCipherEnvelope(envelope({ iterations: 1 }))).toThrow(/WeakKdfIterations/)
    expect(() => validateCipherEnvelope(envelope({ iterations: MIN_PBKDF2_ITERATIONS - 1 }))).toThrow(
      /WeakKdfIterations/
    )
    expect(() => validateCipherEnvelope(envelope({ iterations: MIN_PBKDF2_ITERATIONS }))).not.toThrow()
  })

  it("拒绝过高的迭代次数，避免解密时挂死主线程", () => {
    // localStorage 的内容可被同源脚本改写，iterations=1e12 会让 deriveKey 永不返回
    expect(() => validateCipherEnvelope(envelope({ iterations: 1_000_000_000_000 }))).toThrow(
      /ExcessiveKdfIterations/
    )
    expect(() => validateCipherEnvelope(envelope({ iterations: MAX_PBKDF2_ITERATIONS + 1 }))).toThrow(
      /ExcessiveKdfIterations/
    )
    expect(() => validateCipherEnvelope(envelope({ iterations: MAX_PBKDF2_ITERATIONS }))).not.toThrow()
  })

  it("拒绝非整数迭代次数", () => {
    expect(() => validateCipherEnvelope(envelope({ iterations: 210_000.5 }))).toThrow(/InvalidKdfIterations/)
    expect(() => validateCipherEnvelope(envelope({ iterations: Number.NaN }))).toThrow(/InvalidKdfIterations/)
  })

  it("拒绝长度不合法的 salt 与 nonce", () => {
    expect(() => validateCipherEnvelope(envelope({ salt_b64: "" }))).toThrow(/InvalidSalt/)
    expect(() => validateCipherEnvelope(envelope({ nonce_b64: "" }))).toThrow(/InvalidNonce/)
    // AES-GCM 推荐 12 字节 nonce；16 字节不是当前实现会产出的形状
    expect(() => validateCipherEnvelope(envelope({ nonce_b64: btoa("0123456789abcdef") }))).toThrow(/InvalidNonce/)
  })

  it("拒绝空白密文", () => {
    expect(() => validateCipherEnvelope(envelope({ ct_b64: "" }))).toThrow(/InvalidCiphertext/)
  })
})

describe("decryptString 的信封前置校验", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubWindowCrypto() {
    // node 环境下没有 window；crypto.subtle 用 Node 自带的 webcrypto
    vi.stubGlobal("window", { crypto: globalThis.crypto })
  }

  it("加解密往返仍然正确", async () => {
    stubWindowCrypto()
    const stored = await encryptString("correct horse", "敏感的 API key")
    expect(stored.iterations).toBeGreaterThanOrEqual(MIN_PBKDF2_ITERATIONS)
    expect(await decryptString("correct horse", stored)).toBe("敏感的 API key")
  })

  it("iterations 不可信时在进入 WebCrypto 之前就拒绝", async () => {
    stubWindowCrypto()
    // 修复前：这个信封会被直接送进 deriveKey，错误是 WebCrypto 的 OperationError；
    // 现在必须是自己的 WeakKdfIterations，说明拦截发生在 PBKDF2 之前。
    const weak = envelope({ iterations: 0 })
    await expect(decryptString("pw", weak)).rejects.toThrow(/WeakKdfIterations/)
  })

  it("密文被篡改时 AES-GCM 认证失败而不是返回垃圾", async () => {
    stubWindowCrypto()
    const stored = await encryptString("pw", "payload")
    const tampered: StoredCipherV1 = {
      ...stored,
      ct_b64: btoa(String.fromCharCode(...new Uint8Array(atob(stored.ct_b64).split("").map((c) => c.charCodeAt(0) ^ 1)))),
    }
    await expect(decryptString("pw", tampered)).rejects.toThrow()
  })
})
