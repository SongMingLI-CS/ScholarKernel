import { z } from "zod"

export const ReferenceTypeSchema = z.enum(["article", "book", "conference", "unknown"])
export type ReferenceType = z.infer<typeof ReferenceTypeSchema>

export const AcademicReferenceSchema = z.object({
  id: z.string().default(""),
  type: ReferenceTypeSchema.default("unknown"),
  title: z.string().default(""),
  authors: z.array(z.string()).default([]),
  year: z.string().default(""),
  journal: z.string().nullable().default(null),
  doi: z.string().nullable().default(null),
  raw: z.string().default(""),
})

export type AcademicReference = z.infer<typeof AcademicReferenceSchema>

function normalizeReference(raw: unknown): AcademicReference {
  return AcademicReferenceSchema.parse(raw)
}

function stripOuterBraces(value: string): string {
  let v = value.trim()
  while (v.startsWith("{") && v.endsWith("}")) {
    const inner = v.slice(1, -1).trim()
    if (!inner) break
    v = inner
  }
  return v
}

/** Recursively unwrap nested `{...}` wrappers common in BibTeX values. */
export function stripNestedBraces(value: string): string {
  let v = stripOuterBraces(value)
  let prev = ""
  while (v !== prev) {
    prev = v
    v = v.replace(/\{([^{}]*)\}/g, "$1")
  }
  return v.trim()
}

function unescapeBibTeX(value: string): string {
  return stripNestedBraces(
    value
      .replace(/\\([#%&{}_])/g, "$1")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\s/g, " ")
      .replace(/\{\\"([a-zA-Z])\}/g, "$1")
      .replace(/\{\\([a-zA-Z])\}/g, "$1")
  )
}

/** Brace- or quote-aware BibTeX field value extraction. */
export function extractBibTeXFieldValue(text: string, start: number): { value: string; end: number } | null {
  let i = start
  while (i < text.length && /\s/.test(text[i] ?? "")) i++
  if (i >= text.length) return null

  const opener = text[i]
  if (opener === "{") {
    let depth = 0
    let escaped = false
    const buf: string[] = []
    for (; i < text.length; i++) {
      const ch = text[i]!
      if (escaped) {
        buf.push(ch)
        escaped = false
        continue
      }
      if (ch === "\\") {
        buf.push(ch)
        escaped = true
        continue
      }
      if (ch === "{") {
        depth++
        if (depth > 1) buf.push(ch)
        continue
      }
      if (ch === "}") {
        depth--
        if (depth === 0) return { value: unescapeBibTeX(buf.join("")), end: i + 1 }
        buf.push(ch)
        continue
      }
      buf.push(ch)
    }
    return null
  }

  if (opener === '"') {
    const buf: string[] = []
    i++
    let escaped = false
    for (; i < text.length; i++) {
      const ch = text[i]!
      if (escaped) {
        buf.push(ch)
        escaped = false
        continue
      }
      if (ch === "\\") {
        escaped = true
        continue
      }
      if (ch === '"') return { value: unescapeBibTeX(buf.join("")), end: i + 1 }
      buf.push(ch)
    }
    return null
  }

  const bareEnd = text.slice(i).search(/[\s,}]/)
  const end = bareEnd < 0 ? text.length : i + bareEnd
  return { value: unescapeBibTeX(text.slice(i, end).trim()), end }
}

function normalizeAuthorName(name: string): string {
  const familyPrefix = name.match(/^\{([^{}]+)\},\s*(.+)$/)
  if (familyPrefix) {
    return `${familyPrefix[1]}, ${familyPrefix[2]}`.replace(/\s+/g, " ").trim()
  }
  return stripNestedBraces(name.replace(/\s+/g, " ").trim())
}

function splitAuthors(raw: string): string[] {
  const cleaned = stripNestedBraces(raw).replace(/\s+/g, " ").trim()
  if (!cleaned) return []
  const parts: string[] = []
  let depth = 0
  let buf = ""
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i]!
    if (ch === "{") depth++
    if (ch === "}") depth--
    if (depth === 0) {
      const andSlice = cleaned.slice(i, i + 5).toLowerCase()
      const semiSlice = cleaned.slice(i, i + 2)
      if (andSlice === " and ") {
        const piece = buf.trim()
        if (piece) parts.push(piece)
        buf = ""
        i += 4
        continue
      }
      if (semiSlice === "; ") {
        const piece = buf.trim()
        if (piece) parts.push(piece)
        buf = ""
        i += 1
        continue
      }
    }
    buf += ch
  }
  const tail = buf.trim()
  if (tail) parts.push(tail)
  return parts.map((a) => normalizeAuthorName(a)).filter(Boolean)
}

function parseYearString(raw: string | undefined): string {
  if (!raw?.trim()) return ""
  const digits = raw.match(/\b(19|20)\d{2}\b/)
  return digits ? digits[0]! : raw.trim()
}

function mapBibTypeToReference(type: string): ReferenceType {
  const t = type.toLowerCase()
  if (t === "article") return "article"
  if (t === "book") return "book"
  if (t === "inproceedings" || t === "conference" || t === "proceedings") return "conference"
  return "unknown"
}

function mapRisTypeToReference(type: string): ReferenceType {
  const t = type.toUpperCase()
  if (t === "JOUR" || t === "ARTICLE") return "article"
  if (t === "BOOK") return "book"
  if (t === "CONF" || t === "CPAPER") return "conference"
  return "unknown"
}

function mapReferenceToBibType(type: ReferenceType): string {
  if (type === "article") return "article"
  if (type === "book") return "book"
  if (type === "conference") return "inproceedings"
  return "misc"
}

function parseBibTeXEntryBody(
  body: string,
  entryType: string,
  entryId: string,
  entryRaw: string
): AcademicReference {
  const fields: Record<string, string> = {}
  const fieldRe = /([A-Za-z][A-Za-z0-9_]*)\s*=\s*/g
  let match: RegExpExecArray | null
  while ((match = fieldRe.exec(body)) !== null) {
    const name = (match[1] ?? "").toLowerCase()
    const valueStart = match.index + match[0].length
    const extracted = extractBibTeXFieldValue(body, valueStart)
    if (!extracted) continue
    fields[name] = extracted.value.trim()
    fieldRe.lastIndex = extracted.end
  }

  const authorsRaw = fields.author ?? fields.editor ?? ""
  const journal = fields.journal || fields.journaltitle || fields.booktitle || null

  return normalizeReference({
    id: entryId,
    type: mapBibTypeToReference(entryType),
    title: stripNestedBraces(fields.title ?? ""),
    authors: splitAuthors(authorsRaw),
    year: parseYearString(fields.year ?? fields.date),
    journal,
    doi: fields.doi?.trim() || null,
    raw: entryRaw,
  })
}

const BIB_ENTRY_HEAD_RE = /@([A-Za-z][A-Za-z0-9_-]*)\s*\{\s*([^,\s]+)\s*,/g

export function parseBibTeX(raw: string): AcademicReference[] {
  const text = raw.replace(/\r\n/g, "\n").trim()
  if (!text) return []

  const refs: AcademicReference[] = []
  let head: RegExpExecArray | null
  const heads: Array<{ type: string; id: string; bodyStart: number; index: number }> = []

  while ((head = BIB_ENTRY_HEAD_RE.exec(text)) !== null) {
    heads.push({
      type: head[1] ?? "misc",
      id: head[2] ?? "",
      bodyStart: head.index + head[0].length,
      index: head.index,
    })
  }

  for (let i = 0; i < heads.length; i++) {
    const cur = heads[i]!
    const nextIndex = heads[i + 1]?.index ?? text.length
    let depth = 1
    let j = cur.bodyStart
    for (; j < nextIndex; j++) {
      const ch = text[j]
      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) break
      }
    }
    const entryRaw = text.slice(cur.index, j + 1)
    const body = text.slice(cur.bodyStart, j)
    refs.push(parseBibTeXEntryBody(body, cur.type, cur.id, entryRaw))
  }

  return refs
}

const RIS_TAG_RE = /^([A-Z0-9]{2})\s*-\s*(.*)$/

function parseRisRecord(block: string): AcademicReference | null {
  const lines = block.split(/\r?\n/)
  const acc: {
    authors: string[]
    title: string
    year: string
    journal: string | null
    doi: string | null
  } = { authors: [], title: "", year: "", journal: null, doi: null }
  let type: ReferenceType = "unknown"

  for (const line of lines) {
    const m = line.match(RIS_TAG_RE)
    if (!m) continue
    const tag = (m[1] ?? "").toUpperCase()
    const value = (m[2] ?? "").trim()
    if (!value && tag !== "ER") continue

    switch (tag) {
      case "TY":
        type = mapRisTypeToReference(value)
        break
      case "TI":
      case "T1":
        acc.title = value
        break
      case "AU":
      case "A1":
        acc.authors.push(value)
        break
      case "PY":
      case "Y1":
        acc.year = parseYearString(value)
        break
      case "JO":
      case "JA":
      case "JF":
      case "J2":
        acc.journal = value
        break
      case "DO":
        acc.doi = value
        break
      case "ER":
        break
      default:
        break
    }
  }

  if (!acc.title.trim() && acc.authors.length === 0) return null

  return normalizeReference({
    id: "",
    type,
    title: acc.title,
    authors: acc.authors,
    year: acc.year,
    journal: acc.journal,
    doi: acc.doi,
    raw: block.trim(),
  })
}

export function parseRIS(raw: string): AcademicReference[] {
  const normalized = raw.replace(/\r\n/g, "\n").trim()
  if (!normalized) return []

  const blocks = normalized.split(/(?=^TY\s*-)/m).filter((b) => /^TY\s*-/m.test(b))
  const refs: AcademicReference[] = []
  for (const block of blocks) {
    const rec = parseRisRecord(block)
    if (rec) refs.push(rec)
  }
  return refs
}

/** Unified entry: routes to BibTeX when `@` is present, otherwise RIS. */
export function parseCitations(input: string): AcademicReference[] {
  const trimmed = input.trim()
  if (!trimmed) return []
  if (/@\s*[A-Za-z][A-Za-z0-9_-]*\s*\{/.test(trimmed)) {
    const bib = parseBibTeX(trimmed)
    if (bib.length) return bib
  }
  const ris = parseRIS(trimmed)
  if (ris.length) return ris
  if (/@/.test(trimmed)) return parseBibTeX(trimmed)
  return []
}

/** @deprecated Use parseCitations */
export const parseCitationText = parseCitations

function bibTeXEscape(value: string): string {
  return value.replace(/[{}]/g, "")
}

function referenceBibKey(ref: AcademicReference, index: number): string {
  if (ref.id.trim()) return ref.id.replace(/\W/g, "") || `ref${index}`
  const fromTitle = ref.title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("")
  return (fromTitle || `ref${index}`).replace(/\W/g, "") || `ref${index}`
}

export function serializeReferencesAsBibTeX(refs: AcademicReference[]): string {
  const lines: string[] = []
  refs.forEach((ref, i) => {
    const key = referenceBibKey(ref, i + 1)
    const type = mapReferenceToBibType(ref.type)
    lines.push(`@${type}{${key},`)
    if (ref.title) lines.push(`  title = {${bibTeXEscape(ref.title)}},`)
    if (ref.authors.length) lines.push(`  author = {${ref.authors.map(bibTeXEscape).join(" and ")}},`)
    if (ref.year) lines.push(`  year = {${ref.year}},`)
    if (ref.journal) lines.push(`  journal = {${bibTeXEscape(ref.journal)}},`)
    if (ref.doi) lines.push(`  doi = {${bibTeXEscape(ref.doi)}},`)
    lines.push("}")
    lines.push("")
  })
  return lines.join("\n").trimEnd() + (lines.length ? "\n" : "")
}

function mapRisExportType(type: ReferenceType): string {
  if (type === "article") return "JOUR"
  if (type === "book") return "BOOK"
  if (type === "conference") return "CONF"
  return "GEN"
}

export function serializeReferencesAsRIS(refs: AcademicReference[]): string {
  const blocks: string[] = []
  for (const ref of refs) {
    const lines = [`TY  - ${mapRisExportType(ref.type)}`, `TI  - ${ref.title}`]
    for (const au of ref.authors) lines.push(`AU  - ${au}`)
    if (ref.year) lines.push(`PY  - ${ref.year}`)
    if (ref.journal) lines.push(`JO  - ${ref.journal}`)
    if (ref.doi) lines.push(`DO  - ${ref.doi}`)
    lines.push("ER  - ")
    blocks.push(lines.join("\n"))
  }
  return blocks.join("\n\n") + (blocks.length ? "\n" : "")
}

export function formatReferencesContextBlock(refs: AcademicReference[], lang: "zh" | "en" = "zh"): string {
  if (!refs.length) return ""
  const header =
    lang === "zh"
      ? "[已载入参考文献上下文 — 回答时请优先引用以下文献]"
      : "[Imported reference context — prioritize these citations when relevant]"
  const body = refs
    .map((r, i) => {
      const authors = r.authors.length ? r.authors.join(", ") : lang === "zh" ? "未知作者" : "Unknown authors"
      const year = r.year || (lang === "zh" ? "无年份" : "n.d.")
      const venue = r.journal ? `. ${r.journal}` : ""
      const doi = r.doi ? ` DOI:${r.doi}` : ""
      return `- [${i + 1}] ${authors} (${year}). ${r.title || (lang === "zh" ? "无标题" : "Untitled")}${venue}${doi}`
    })
    .join("\n")
  return [header, body, "---", ""].join("\n")
}

const MD_REF_HEADING_RE = /^#{1,3}\s*(参考文献|references?)(?:\s|\(|$)/i

export function extractReferencesFromMarkdown(md: string): AcademicReference[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n")
  let inRefs = false
  const refs: AcademicReference[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (MD_REF_HEADING_RE.test(trimmed)) {
      inRefs = true
      continue
    }
    if (!inRefs || !trimmed) continue

    const numbered = trimmed.match(/^\[(\d+)\]\s*(.+)$/)
    const bullet = trimmed.match(/^[-*•]\s+\[(\d+)\]\s*(.+)$/)
    const body = bullet?.[2] ?? numbered?.[2] ?? trimmed.replace(/^[-*•]\s+/, "")

    const authorYear = body.match(/^(.+?)\s*\((\d{4}|n\.d\.)\)\.\s*(.+)$/)
    if (authorYear) {
      const authors = authorYear[1]!
        .split(/,| and /i)
        .map((a) => a.trim())
        .filter(Boolean)
      const yearRaw = authorYear[2]!
      const rest = authorYear[3]!
      const doiMatch = rest.match(/\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i)
      refs.push(
        normalizeReference({
          title: rest.replace(/\s*DOI:.*$/i, "").trim(),
          authors,
          year: yearRaw === "n.d." ? "" : yearRaw,
          doi: doiMatch?.[1] ?? null,
          raw: trimmed,
        })
      )
      continue
    }

    if (body.length > 8) {
      refs.push(normalizeReference({ title: body, raw: trimmed }))
    }
  }

  return refs
}
