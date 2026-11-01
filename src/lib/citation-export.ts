import { bibTeXKeyFromTitle, bibTeXYear, collapseWhitespace, escapeBibTeXField, uniqueBibTeXKey } from "@/lib/bibtex-format"

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

export function exportSourcesAsBibTeX(sources: CitationSource[]): string {
  const lines: string[] = []
  const usedKeys = new Set<string>()
  sources.forEach((s, i) => {
    const key = uniqueBibTeXKey(bibTeXKeyFromTitle(s.title, `ref${i + 1}`), usedKeys)
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
