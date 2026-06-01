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

export function exportSourcesAsBibTeX(sources: CitationSource[]): string {
  const lines: string[] = []
  sources.forEach((s, i) => {
    const key = bibTeXKey(s, i + 1)
    lines.push(`@misc{${key},`)
    lines.push(`  title = {${s.title.replace(/[{}]/g, "")}},`)
    lines.push(`  url = {${s.url}},`)
    if (s.publishedAt) lines.push(`  year = {${s.publishedAt.replace(/[{}]/g, "")}},`)
    if (s.snippet) lines.push(`  note = {${s.snippet.slice(0, 240).replace(/[{}]/g, "")}},`)
    lines.push("}")
    lines.push("")
  })
  return lines.join("\n").trimEnd() + "\n"
}

export function exportSourcesAsRIS(sources: CitationSource[]): string {
  const blocks: string[] = []
  for (const s of sources) {
    const lines = ["TY  - GEN", `TI  - ${s.title}`, `UR  - ${s.url}`]
    if (s.publishedAt) lines.push(`PY  - ${s.publishedAt}`)
    if (s.snippet) lines.push(`N1  - ${s.snippet.slice(0, 500)}`)
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
