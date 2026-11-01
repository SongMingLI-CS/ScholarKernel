export type CitationSource = {
  source_id?: string
  title: string
  url: string
  snippet?: string
  publishedAt?: string
}

export function collectCitationSources(
  hits: Array<{ title: string; url: string; snippet?: string; publishedAt?: string; source_id?: string }>
): CitationSource[] {
  const seen = new Set<string>()
  const out: CitationSource[] = []
  for (const h of hits) {
    const url = (h.url ?? "").trim()
    const title = (h.title ?? "").trim()
    if (!url || !title) continue
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      source_id: h.source_id,
      title,
      url,
      ...(h.snippet ? { snippet: h.snippet } : {}),
      ...(h.publishedAt ? { publishedAt: h.publishedAt } : {}),
    })
  }
  return out
}

const BIBTEX_ESCAPE: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
}

/** 记录型格式（RIS）与 BibTeX 都不允许字段里出现裸换行，先折成空格。 */
function collapseWhitespace(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[ \t]{2,}/g, " ").trim()
}

function escapeBibTeXField(value: string): string {
  // 单次扫描替换，避免「先替换反斜杠、再把新插入的花括号又转义一遍」
  return collapseWhitespace(value).replace(/[\\&%$#_{}~^]/g, (c) => BIBTEX_ESCAPE[c] ?? c)
}

/** BibTeX 的 year 字段要求四位年份，`publishedAt` 常带完整日期。 */
function bibTeXYear(raw: string): string | null {
  const m = /(?:^|\D)(\d{4})(?:\D|$)/.exec(raw)
  return m ? m[1]! : null
}

function bibTeXKey(source: CitationSource, index: number): string {
  const fromTitle = source.title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("")
  return (fromTitle || `ref${index}`).replace(/\W/g, "") || `ref${index}`
}

/**
 * 引用键必须唯一：两篇标题前缀相同的论文（"Deep Learning Approach for A/B"）
 * 会算出同一个键，BibTeX 直接报重复条目，引用全部错位。
 */
function uniqueBibTeXKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let n = 2
  while (used.has(`${base}${n}`)) n += 1
  const key = `${base}${n}`
  used.add(key)
  return key
}

export function exportSourcesAsBibTeX(sources: CitationSource[]): string {
  const lines: string[] = []
  const usedKeys = new Set<string>()
  sources.forEach((s, i) => {
    const key = uniqueBibTeXKey(bibTeXKey(s, i + 1), usedKeys)
    lines.push(`@misc{${key},`)
    lines.push(`  title = {${escapeBibTeXField(s.title)}},`)
    lines.push(`  url = {${escapeBibTeXField(s.url)}},`)
    const year = s.publishedAt ? bibTeXYear(s.publishedAt) : null
    if (year) lines.push(`  year = {${year}},`)
    if (s.snippet) lines.push(`  note = {${escapeBibTeXField(s.snippet.slice(0, 240))}},`)
    lines.push("}")
    lines.push("")
  })
  return lines.join("\n").trimEnd() + "\n"
}

export function exportSourcesAsRIS(sources: CitationSource[]): string {
  const blocks: string[] = []
  for (const s of sources) {
    const lines = ["TY  - GEN", `TI  - ${collapseWhitespace(s.title)}`, `UR  - ${collapseWhitespace(s.url)}`]
    if (s.publishedAt) lines.push(`PY  - ${collapseWhitespace(s.publishedAt)}`)
    if (s.snippet) lines.push(`N1  - ${collapseWhitespace(s.snippet.slice(0, 500))}`)
    lines.push("ER  - ")
    blocks.push(lines.join("\n"))
  }
  return blocks.join("\n\n") + "\n"
}

export function collectSourcesFromMessages(
  messages: Array<{ role: string; sources?: CitationSource[] }>
): CitationSource[] {
  const all: CitationSource[] = []
  for (const m of messages) {
    if (m.role === "assistant" && m.sources?.length) {
      all.push(...m.sources)
    }
  }
  return collectCitationSources(all)
}
