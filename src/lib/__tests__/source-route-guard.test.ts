import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  isSafeRelativePath,
  isServableSourcePath,
  resolveSourceFilePath,
} from "../source-route-guard"

/**
 * `/api/source` 原本只挡绝对路径、`..` 与 `node_modules`，
 * 于是 `?path=.env` 会把应用根目录下的 `.env` 以 text/plain 吐出来。
 * 该路由不在 middleware 的保护列表里、自身也无鉴权，属于**未授权读取凭据**。
 */

describe("路径形态校验", () => {
  it("拒绝空值与 NUL", () => {
    expect(isSafeRelativePath("")).toBe(false)
    expect(isSafeRelativePath("src/a\0b.ts")).toBe(false)
  })

  it("拒绝绝对路径与盘符形式", () => {
    expect(isSafeRelativePath("/etc/passwd")).toBe(false)
    expect(isSafeRelativePath("C:/Windows/win.ini")).toBe(false)
  })

  it("拒绝上跳目录", () => {
    expect(isSafeRelativePath("../x.ts")).toBe(false)
    expect(isSafeRelativePath("src/../../x.ts")).toBe(false)
    expect(isSafeRelativePath("src\\..\\x.ts")).toBe(false)
  })

  it("拒绝点开头的文件与目录", () => {
    expect(isSafeRelativePath(".env")).toBe(false)
    expect(isSafeRelativePath(".env.local")).toBe(false)
    expect(isSafeRelativePath(".git/config")).toBe(false)
    expect(isSafeRelativePath("src/.next/build.json")).toBe(false)
  })

  it("拒绝 node_modules（保留原有规则）", () => {
    expect(isSafeRelativePath("node_modules/react/index.js")).toBe(false)
  })

  it("放行普通源码路径", () => {
    expect(isSafeRelativePath("src/lib/crypto.ts")).toBe(true)
    expect(isSafeRelativePath("README.md")).toBe(true)
  })
})

describe("文件类型守卫", () => {
  it("敏感基名被拒绝", () => {
    expect(isServableSourcePath("credentials.json")).toBe(false)
    expect(isServableSourcePath("keys/id_rsa")).toBe(false)
  })

  it("私钥与本地数据库即便扩展名白名单也不放行", () => {
    expect(isServableSourcePath("certs/server.pem")).toBe(false)
    expect(isServableSourcePath("certs/server.KEY")).toBe(false)
    expect(isServableSourcePath("prisma/dev.sqlite")).toBe(false)
  })

  it("非文本扩展名被拒绝", () => {
    expect(isServableSourcePath("bin/app.exe")).toBe(false)
    expect(isServableSourcePath("assets/logo.png")).toBe(false)
  })

  it("源码与文本放行", () => {
    expect(isServableSourcePath("src/app/page.tsx")).toBe(true)
    expect(isServableSourcePath("docs/notes.md")).toBe(true)
    expect(isServableSourcePath("package.json")).toBe(true)
  })
})

describe("resolveSourceFilePath", () => {
  let root = ""
  let outside = ""

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "sk-src-guard-"))
    outside = mkdtempSync(path.join(tmpdir(), "sk-src-outside-"))
    mkdirSync(path.join(root, "src"), { recursive: true })
    writeFileSync(path.join(root, "src", "ok.ts"), "export const ok = 1\n")
    writeFileSync(path.join(root, ".env"), "SECRET=should-not-leak\n")
    writeFileSync(path.join(outside, "secret.ts"), "export const leak = 1\n")
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it("可读文件返回绝对路径", () => {
    const abs = resolveSourceFilePath(root, "src/ok.ts")
    expect(abs).toBe(path.join(root, "src", "ok.ts"))
  })

  it(".env 取不到路径", () => {
    expect(resolveSourceFilePath(root, ".env")).toBeNull()
  })

  it("不存在的文件返回 null 而不是抛错", () => {
    expect(resolveSourceFilePath(root, "src/missing.ts")).toBeNull()
  })

  it("根目录外的绝对路径返回 null", () => {
    expect(resolveSourceFilePath(root, path.join(outside, "secret.ts"))).toBeNull()
  })
})
