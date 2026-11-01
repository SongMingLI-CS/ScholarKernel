import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * 工程不变量：把本轮踩过的坑写成**可执行**的约束，避免同类缺陷再长回来。
 *
 * 这些断言读源码文本，属于结构性检查，不替代行为测试 —— 它们回答的是
 * 「有没有人又把门拆了」，而不是「功能对不对」。
 */

const SRC = join(process.cwd(), "src")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue
      walk(full, out)
    } else if (/\.(?:ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function rel(full: string): string {
  return relative(SRC, full).split(sep).join("/")
}

function read(full: string): string {
  return readFileSync(full, "utf8")
}

const SOURCE_FILES = walk(SRC)
const ROUTE_FILES = SOURCE_FILES.filter((f) => rel(f).startsWith("app/api/") && f.endsWith("route.ts"))

/**
 * 允许不调鉴权解析器的路由：要么本来就该公开，要么自己实现了 token 校验。
 * 新增路由时必须**显式**加到这里，否则测试失败 —— 这正是 SK-42 要防的：
 * 「新增接口只要忘了登记就等于公开」。
 */
const PUBLIC_ROUTES = new Set([
  "app/api/health/route.ts",
  "app/api/auth/[...nextauth]/route.ts",
  "app/api/auth/logout/route.ts",
])

const AUTH_CALL_RE = /resolveUserIdFromRequest|checkProxyAuth|isAuthEnabled|timingSafeEqual/

describe("不变量 1：每个 API 路由自带鉴权，或显式列入公开白名单", () => {
  it("没有遗漏的路由", () => {
    const missing = ROUTE_FILES.filter((f) => {
      const r = rel(f)
      if (PUBLIC_ROUTES.has(r)) return false
      return !AUTH_CALL_RE.test(read(f))
    }).map(rel)
    expect(missing).toEqual([])
  })

  it("扫描确实覆盖到了路由文件", () => {
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(15)
  })
})

describe("不变量 2：不出现 dangerouslySetInnerHTML", () => {
  it("渲染一律走 React，HTML 只从白名单净化后的出口产生", () => {
    const offenders = SOURCE_FILES.filter((f) => read(f).includes("dangerouslySetInnerHTML")).map(rel)
    expect(offenders).toEqual([])
  })
})

describe("不变量 3：crypto.randomUUID 必须带可用性守卫", () => {
  it("非安全上下文下会 undefined，不能直接调用", () => {
    const offenders: string[] = []
    for (const f of SOURCE_FILES) {
      const text = read(f)
      if (!/crypto\.randomUUID/.test(text) && !/\.randomUUID\(/.test(text)) continue
      // 守卫三选一：typeof 检查、in 检查、可选调用
      const guarded =
        /typeof\s+crypto/.test(text) ||
        /"randomUUID"\s+in\s+crypto/.test(text) ||
        /randomUUID\?\./.test(text) ||
        /typeof\s+\w+\.randomUUID\s*===\s*"function"/.test(text)
      if (!guarded) offenders.push(rel(f))
    }
    expect(offenders).toEqual([])
  })
})

describe("不变量 5：模块级 /g 正则不得用于 .test()", () => {
  /**
   * `RegExp` 带 `g` 标志时 `test()` 会推进并保留 `lastIndex`，
   * 同一个正则第二次调用会从上次位置继续找 —— 于是「第一次 true、第二次 false」，
   * 而且结果取决于调用顺序，测试里时红时绿。
   *
   * 这不是假想：`peer-review-score-gap` 里把否定式短语的屏蔽正则（`/g`）
   * 直接拿去 `test()`，同一进程内第二次判定就会漏掉否定前缀。
   */
  it("模块级 /g 正则只用 replace/matchAll/exec 循环，不用 test()", () => {
    const DECL = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\/(?:[^/\\\n]|\\.)+\/([gimsuy]*)/
    const offenders: string[] = []
    for (const f of SOURCE_FILES) {
      const text = read(f)
      const globalNames: string[] = []
      for (const line of text.split("\n")) {
        const m = line.match(DECL)
        if (m?.[1] && m[2]?.includes("g")) globalNames.push(m[1])
      }
      if (!globalNames.length) continue
      const hit = globalNames.some((name) => new RegExp(`\\b${name}\\.test\\(`).test(text))
      if (hit) offenders.push(rel(f))
    }
    expect(offenders).toEqual([])
  })
})

describe("不变量 4：路由不得裸读请求体", () => {
  it("request body 一律经 parseJsonBody / 有界读取，避免无上限缓冲", () => {
    const offenders = ROUTE_FILES.filter((f) => /await\s+req\.json\(\)/.test(read(f))).map(rel)
    expect(offenders).toEqual([])
  })

  /**
   * 上一版只查路由 —— 但 `parseJsonBody` 自己就是 `await req.json()`，
   * 等于把「有界」两个字写在了注释里。现在改成全仓库禁裸调：
   * 任何 `req.json()` / `request.json()` 都意味着有人在绕过体积上限。
   * 注释里出现该字样不算违规，所以按「行内非注释」判定。
   */
  it("全仓库都不直接调用 req.json()（含 api-utils 自身）", () => {
    const offenders: string[] = []
    for (const f of SOURCE_FILES) {
      const hit = read(f)
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
        .some((line) => /\b(req|request)\.json\(\)/.test(line))
      if (hit) offenders.push(rel(f))
    }
    expect(offenders).toEqual([])
  })
})
