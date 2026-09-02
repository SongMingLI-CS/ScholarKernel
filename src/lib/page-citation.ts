/** Page citation patterns: [p.4], [Page 4], [page 7], data-page="4" HTML tags */

export const PAGE_CITATION_REGEX =
  /\[p\.?\s*(\d+)\]|\[Page\s+(\d+)\]|\[page\s+(\d+)\]|<[^>]*\bdata-page=["'](\d+)["'][^>]*>([\s\S]*?)<\/[^>]+>/gi

export type PageCitationSegment =
  | { kind: "text"; content: string }
  | { kind: "citation"; content: string; page: number }

export function parsePageNumberFromCitation(match: string): number | null {
  const m =
    match.match(/\[p\.?\s*(\d+)\]/i) ??
    match.match(/\[Page\s+(\d+)\]/i) ??
    match.match(/\[page\s+(\d+)\]/i) ??
    match.match(/data-page=["'](\d+)["']/i)
  if (!m?.[1]) return null
  const n = Number.parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Split plain text / markdown into text and page-citation segments. */
export function segmentPageCitations(text: string): PageCitationSegment[] {
  if (!text) return []
  const segments: PageCitationSegment[] = []
  let lastIndex = 0
  const re = new RegExp(PAGE_CITATION_REGEX.source, "gi")
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    const full = match[0]
    const page = Number.parseInt(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "", 10)
    if (!Number.isFinite(page) || page <= 0) continue

    if (match.index > lastIndex) {
      segments.push({ kind: "text", content: text.slice(lastIndex, match.index) })
    }

    const label =
      match[5] != null && String(match[5]).trim()
        ? String(match[5]).trim()
        : full.startsWith("<")
          ? `[Page ${page}]`
          : full

    segments.push({ kind: "citation", content: label, page })
    lastIndex = match.index + full.length
  }

  if (lastIndex < text.length) {
    segments.push({ kind: "text", content: text.slice(lastIndex) })
  }

  return segments.length ? segments : [{ kind: "text", content: text }]
}

export const CITATION_ANCHOR_CLASS =
  "sk-page-citation border-b border-dashed border-amber-500 text-amber-400 cursor-pointer hover:bg-amber-950/30 px-0.5 rounded"

/** Wrap page citations in interactive HTML spans for TipTap / Canvas. */
export function injectPageCitationAnchors(markdown: string): string {
  return markdown.replace(
    /\[p\.?\s*(\d+)\]|\[Page\s+(\d+)\]|\[page\s+(\d+)\]/gi,
    (full, p1: string, p2: string, p3: string) => {
      const page = Number.parseInt(p1 ?? p2 ?? p3 ?? "", 10)
      if (!Number.isFinite(page) || page <= 0) return full
      return pageCitationToHtml(page, full)
    }
  )
}

export function pageCitationToHtml(page: number, label: string): string {
  const safeLabel = label.replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return `<span class="${CITATION_ANCHOR_CLASS}" data-page="${page}" data-sk-citation="page" role="button" tabindex="0">${safeLabel}</span>`
}
