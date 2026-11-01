/**
 * 来源条目（`message.metadata.sources`）的清洗。
 *
 * 这些 url 会直接进 `<a href={s.url} target="_blank">`（chat-panel.tsx 的 SourcesFoldout），
 * 而 metadata 有三个不受信任的入口：
 *
 * 1. `POST /api/conversations/[id]/messages` 的 `body.metadata`——原样落库；
 * 2. 备份 JSON 文件（`parseConversationBackupPayload`）；
 * 3. 检索工具的返回（搜索结果本身就是外部内容）。
 *
 * 之前的校验只到 `typeof url === "string"`，于是 `javascript:` / `data:` 能一路走到 href。
 * 这里改成**协议白名单**：只放 http / https，其余整条丢弃。
 * （与 export-utils.ts 的导出净化同一策略：白名单优先于黑名单。）
 */

export type NormalizedSource = {
  title: string
  url: string
  snippet?: string
  publishedAt?: string
  source_id?: string
}

/** 单条消息最多保留的来源条数。UI 只渲染前 12 条，导出会全量使用。 */
export const MAX_SOURCES_PER_MESSAGE = 200

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"])

/**
 * 控制字符与空白在 URL 里可以拆开协议名（`java\tscript:`），
 * 浏览器解析 href 时会忽略它们，所以判断前必须先抹掉。
 */
const URL_NOISE_RE = /[\u0000-\u0020\u007f]+/g

/**
 * 返回可安全放进 href 的 url，不安全则返回 null。
 *
 * 保留原始字符串（不做 `new URL().toString()` 归一化），避免改变已有数据里
 * 的数字签名链接、大小写路径等——这里只负责判定协议是否可点。
 */
export function sanitizeSourceUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const compact = trimmed.replace(URL_NOISE_RE, "")
  if (!compact) return null
  let protocol: string
  try {
    protocol = new URL(compact).protocol
  } catch {
    // 相对地址、裸域名、非法 URL 一律拒绝：来源本来就该是绝对地址
    return null
  }
  return ALLOWED_PROTOCOLS.has(protocol) ? compact : null
}

export function normalizeSources(raw: unknown, limit = MAX_SOURCES_PER_MESSAGE): NormalizedSource[] {
  if (!Array.isArray(raw)) return []
  const out: NormalizedSource[] = []
  for (const item of raw) {
    if (out.length >= limit) break
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const rec = item as Record<string, unknown>
    const title = typeof rec.title === "string" ? rec.title.trim() : ""
    const url = sanitizeSourceUrl(rec.url)
    if (!title || !url) continue
    out.push({
      title,
      url,
      ...(typeof rec.snippet === "string" ? { snippet: rec.snippet } : {}),
      ...(typeof rec.publishedAt === "string" ? { publishedAt: rec.publishedAt } : {}),
      ...(typeof rec.source_id === "string" ? { source_id: rec.source_id } : {}),
    })
  }
  return out
}
