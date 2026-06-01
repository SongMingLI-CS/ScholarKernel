/** DOI / 文献元数据导入（Crossref API，无 Key 即可查询公开元数据） */

export type ReferenceMetadata = {
  doi: string
  title?: string
  authors?: string[]
  year?: number
  url?: string
}

const DOI_RE = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i

export function extractDoi(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const fromUrl = trimmed.match(/doi\.org\/(10\.\S+)/i)
  if (fromUrl?.[1]) return fromUrl[1].replace(/[)\].,;]+$/, "")
  const m = trimmed.match(DOI_RE)
  return m?.[1] ?? null
}

function authorLabel(a: { given?: string; family?: string }): string {
  const given = typeof a.given === "string" ? a.given.trim() : ""
  const family = typeof a.family === "string" ? a.family.trim() : ""
  return [given, family].filter(Boolean).join(" ").trim()
}

export async function fetchMetadataByDoi(doi: string): Promise<ReferenceMetadata | null> {
  const normalized = extractDoi(doi)
  if (!normalized) return null
  const url = `https://api.crossref.org/works/${encodeURIComponent(normalized)}`
  const res = await fetch(url, { headers: { Accept: "application/json" } })
  if (!res.ok) return null
  const json = (await res.json()) as {
    message?: {
      DOI?: string
      title?: string[]
      author?: Array<{ given?: string; family?: string }>
      published?: { "date-parts"?: number[][] }
      URL?: string
    }
  }
  const msg = json.message
  if (!msg) return null
  const year = msg.published?.["date-parts"]?.[0]?.[0]
  return {
    doi: msg.DOI ?? normalized,
    title: msg.title?.[0],
    authors: (msg.author ?? []).map(authorLabel).filter(Boolean),
    year: typeof year === "number" ? year : undefined,
    url: msg.URL ?? `https://doi.org/${normalized}`,
  }
}

export function formatReferenceBlock(meta: ReferenceMetadata): string {
  const authors = meta.authors?.length ? meta.authors.join(", ") : "Unknown authors"
  const year = meta.year ?? "n.d."
  const title = meta.title ?? "Untitled"
  return `[${authors} (${year}). ${title}. DOI: ${meta.doi}${meta.url ? ` · ${meta.url}` : ""}]`
}
