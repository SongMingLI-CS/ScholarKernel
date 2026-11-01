import path from "node:path"
import { realpathSync } from "node:fs"

/**
 * `/api/source` 的路径守卫。
 *
 * 原实现只挡了绝对路径、`..` 与 `node_modules`，于是
 * `GET /api/source?path=.env` 会以 `text/plain` 返回应用根目录下的 `.env`
 * —— 里面是 DATABASE_URL、AUTH_SECRET、各家 API Key。
 * 该路由不在 middleware 的保护列表里（`isProtectedPath` 只覆盖
 * conversations / agent / canvas），且自身没有任何鉴权，因此**无需登录即可读取**。
 *
 * 这里改成三条同时生效的规则：
 * 1. 路径形态：非绝对、无 `..`、无点开头的段（挡 `.env` / `.git` / `.next`）
 * 2. 文件类型：只放行源码/文本扩展名，并显式拒绝私钥与数据库文件
 * 3. 真实路径：`realpath` 后仍需落在根目录内（挡符号链接逃逸）
 */

/** 允许读取的文本/源码扩展名。二进制、私钥、数据库一律不在表内。 */
export const SERVABLE_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".swift",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".php",
  ".sh", ".bash", ".zsh", ".sql",
  ".md", ".mdx", ".txt", ".rst",
  ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini",
  ".css", ".scss", ".less", ".html", ".htm", ".vue", ".svelte", ".xml",
  ".csv", ".tsv", ".graphql", ".proto",
])

/** 与扩展名无关、但语义上一定是敏感文件的基名。 */
const DENIED_BASENAMES: ReadonlySet<string> = new Set([
  "credentials.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
])

/** 私钥 / 证书库 / 本地数据库：即便扩展名在白名单里也不放行。 */
const DENIED_FILE_RE = /\.(?:pem|key|p12|pfx|jks|keystore|db|db3|sqlite|sqlite3)$/i

/** 形态校验：不含 NUL、非绝对、无 `..`、无点开头段、不进 node_modules。 */
export function isSafeRelativePath(rel: string): boolean {
  if (!rel || rel.includes("\0")) return false
  if (path.isAbsolute(rel)) return false
  // Windows 盘符形式在 POSIX isAbsolute 下不算绝对路径
  if (/^[a-zA-Z]:/.test(rel)) return false
  const norm = rel.replace(/\\/g, "/")
  const segments = norm.split("/")
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false
  if (segments.some((s) => s.startsWith("."))) return false
  if (segments[0] === "node_modules") return false
  return true
}

/** 形态 + 文件类型双重校验。 */
export function isServableSourcePath(rel: string): boolean {
  if (!isSafeRelativePath(rel)) return false
  const base = path.posix.basename(rel.replace(/\\/g, "/")).toLowerCase()
  if (DENIED_BASENAMES.has(base)) return false
  if (DENIED_FILE_RE.test(base)) return false
  const ext = path.posix.extname(base)
  if (!ext) return false
  return SERVABLE_SOURCE_EXTENSIONS.has(ext)
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  if (!rel) return false
  return !rel.startsWith("..") && !path.isAbsolute(rel)
}

/**
 * 解析出可读取的绝对路径；不满足任何一条规则时返回 null。
 * `realpath` 之后仍要求落在根目录内 —— 否则根目录里的一个符号链接就能读到任意文件。
 */
export function resolveSourceFilePath(root: string, rel: string): string | null {
  if (!isServableSourcePath(rel)) return null
  const rootResolved = path.resolve(root)
  const abs = path.resolve(rootResolved, rel)
  if (!isInside(rootResolved, abs)) return null
  try {
    const realRoot = realpathSync(rootResolved)
    const realAbs = realpathSync(abs)
    if (!isInside(realRoot, realAbs)) return null
    return realAbs
  } catch {
    return null
  }
}
