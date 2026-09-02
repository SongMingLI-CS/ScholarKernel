export type LibraryChunkCandidate = {
  documentId: string
  documentTitle: string
  chunkIndex: number
  section: string
  page?: number | null
  content: string
}

export type RetrievedLibraryChunk = LibraryChunkCandidate & { score: number }

export function splitLibraryChunkText(text: string, maxChars = 2_400): string[] {
  const limit = Math.max(200, Math.floor(maxChars))
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const out: string[] = []
  let current = ""
  const flush = () => {
    if (current.trim()) out.push(current.trim())
    current = ""
  }
  for (const paragraph of paragraphs) {
    if (paragraph.length > limit) {
      flush()
      for (let offset = 0; offset < paragraph.length; offset += limit) {
        out.push(paragraph.slice(offset, offset + limit).trim())
      }
      continue
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph
    if (next.length > limit) flush()
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  flush()
  return out.filter(Boolean)
}

function terms(text: string): Set<string> {
  const normalized = text.toLowerCase()
  const out = new Set(normalized.match(/[a-z0-9][a-z0-9_-]{1,}|[\u3400-\u9fff]/g) ?? [])
  const cjk = [...normalized].filter((char) => /[\u3400-\u9fff]/.test(char))
  for (let index = 0; index + 1 < cjk.length; index++) out.add(`${cjk[index]}${cjk[index + 1]}`)
  return out
}

function relevance(queryTerms: Set<string>, chunk: LibraryChunkCandidate): number {
  if (!queryTerms.size) return 0
  const contentTerms = terms(`${chunk.documentTitle} ${chunk.section} ${chunk.content}`)
  let matches = 0
  for (const term of queryTerms) if (contentTerms.has(term)) matches += 1
  const titleTerms = terms(chunk.documentTitle)
  let titleMatches = 0
  for (const term of queryTerms) if (titleTerms.has(term)) titleMatches += 1
  return matches / Math.sqrt(Math.max(1, contentTerms.size)) + titleMatches * 0.75
}

export function retrieveRelevantLibraryChunks(
  query: string,
  chunks: LibraryChunkCandidate[],
  options: { maxChunks?: number; maxChars?: number } = {}
): RetrievedLibraryChunk[] {
  const maxChunks = Math.max(1, Math.floor(options.maxChunks ?? 10))
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? 12_000))
  const queryTerms = terms(query)
  const ranked = chunks
    .map((chunk) => ({ ...chunk, score: relevance(queryTerms, chunk) }))
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
  const candidates = ranked.some((chunk) => chunk.score > 0)
    ? ranked.filter((chunk) => chunk.score > 0)
    : ranked.slice(0, Math.min(maxChunks, 4))

  const selected: RetrievedLibraryChunk[] = []
  let usedChars = 0
  for (const chunk of candidates) {
    if (selected.length >= maxChunks) break
    if (usedChars + chunk.content.length > maxChars) continue
    selected.push(chunk)
    usedChars += chunk.content.length
  }
  return selected
}

export function formatRetrievedLibraryContext(chunks: RetrievedLibraryChunk[]): string {
  if (!chunks.length) return ""
  const blocks = chunks.map((chunk) => {
    const page = chunk.page ? ` · p.${chunk.page}` : ""
    return [
      `### ${chunk.documentTitle} · ${chunk.section}${page} · chunk ${chunk.chunkIndex}`,
      chunk.content.trim(),
    ].join("\n")
  })
  return [
    "[我的文献库：按当前问题召回的证据片段，不代表完整文档]",
    ...blocks,
    "[文献库证据结束]",
    "",
  ].join("\n\n")
}
