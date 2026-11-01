import fs from "node:fs"

import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { safeReadTextFile } from "@/lib/tools/file-reader-server"

/**
 * 回归：Agent 的本地文件工具（createFileTool(safeReadTextFile)）入参由模型产生，
 * 历史实现直接 path.join(cwd, 用户路径) 且不做包含性校验，
 * 因此 `../../` 或绝对路径可以读取项目根目录之外的任意文件（例如 .env 中的密钥）。
 */
const ROOT = process.cwd()
// 同盘符的根目录兄弟目录，保证 path.relative 能给出真正的 ".." 相对路径
const probeDir = fs.mkdtempSync(path.join(ROOT, "..", "sk-traversal-probe-"))
const outsideFile = path.join(probeDir, "outside-secret.txt")
fs.writeFileSync(outsideFile, "TOP_SECRET_OUTSIDE_ROOT", "utf8")

const escapeRel = path.relative(ROOT, outsideFile).replace(/\\/g, "/")

afterAll(() => {
  fs.rmSync(probeDir, { recursive: true, force: true })
})

describe("safeReadTextFile containment", () => {
  it("uses a probe path that really escapes the project root", () => {
    expect(escapeRel.startsWith("..")).toBe(true)
  })

  it("rejects relative traversal outside the project root", async () => {
    const res = await safeReadTextFile(escapeRel)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("unreachable")
    expect(res.error).toBe("PathOutsideRoot")
    expect(JSON.stringify(res)).not.toContain("TOP_SECRET_OUTSIDE_ROOT")
  })

  it("rejects absolute paths", async () => {
    const res = await safeReadTextFile(outsideFile)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error("unreachable")
    expect(res.error).toBe("PathOutsideRoot")
  })

  it("rejects bare parent traversals", async () => {
    for (const p of ["..", "../", "../../", "../.."]) {
      const res = await safeReadTextFile(p)
      expect(res.ok).toBe(false)
    }
  })

  it("still reads files inside the project root", async () => {
    const res = await safeReadTextFile("package.json")
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error("unreachable")
    expect(res.text).toContain("scholarkernel-web")
  })

  it("still allows inner traversal that resolves inside the root", async () => {
    const inner = path.relative(ROOT, path.join(ROOT, "package.json")).replace(/\\/g, "/")
    const res = await safeReadTextFile(`src/../${inner}`)
    expect(res.ok).toBe(true)
  })
})
