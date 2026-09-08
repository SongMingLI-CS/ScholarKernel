export type LibraryChunkCandidate = {
  documentId: string
  chunkId?: string
  documentTitle: string
  chunkIndex: number
  section: string
  headingPath?: string[]
  page?: number | null
  paragraphStart?: number | null
  paragraphEnd?: number | null
  content: string
}

export type RankedLibraryChunk = LibraryChunkCandidate & {
  lexicalScore?: number
  lexicalRank?: number
  vectorScore?: number
  vectorRank?: number
  fusedRank?: number
  fusedScore?: number
}

export type StructuredLibraryEvidence = {
  documentId: string
  chunkId: string
  chunkIndex: number
  mergedChunkIds: string[]
  title: string
  headingPath: string[]
  pageNumber: number | null
  paragraphStart: number | null
  paragraphEnd: number | null
  text: string
  lexicalRank: number | null
  vectorRank: number | null
  fusedRank: number
  score: number
  scoreExplanation: {
    method: "bm25" | "vector" | "rrf"
    lexicalScore?: number
    vectorScore?: number
    rrfScore: number
    degraded?: "vector-unavailable"
  }
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
      for (let offset = 0; offset < paragraph.length; offset += limit) out.push(paragraph.slice(offset, offset + limit).trim())
      continue
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph
    if (next.length > limit) flush()
    current = current ? `${current}\n\n${paragraph}` : paragraph
  }
  flush()
  return out.filter(Boolean)
}

export function tokenizeLibraryText(text: string): string[] {
  const normalized = text.toLowerCase()
  const terms: string[] = normalized.match(/[a-z0-9][a-z0-9_-]{1,}|[\u3400-\u9fff]/g) ?? []
  const cjk = [...normalized].filter((char) => /[\u3400-\u9fff]/.test(char))
  for (let index = 0; index + 1 < cjk.length; index++) terms.push(`${cjk[index]}${cjk[index + 1]}`)
  return terms
}

/** Deterministic in-memory BM25, retained as the lexical retrieval path. */
export function rankLibraryChunksBm25(query: string, chunks: LibraryChunkCandidate[]): RankedLibraryChunk[] {
  const queryTerms = [...new Set(tokenizeLibraryText(query))]
  if (!chunks.length) return []
  const tokenized = chunks.map((chunk) => tokenizeLibraryText(`${chunk.documentTitle} ${chunk.section} ${chunk.content}`))
  const avgLength = tokenized.reduce((sum, row) => sum + row.length, 0) / Math.max(1, tokenized.length)
  const documentFrequency = new Map<string, number>()
  for (const row of tokenized) for (const term of new Set(row)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  const k1 = 1.2
  const b = 0.75
  const ranked = chunks.map((chunk, index) => {
    const row = tokenized[index] ?? []
    const frequencies = new Map<string, number>()
    for (const term of row) frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
    let lexicalScore = 0
    for (const term of queryTerms) {
      const tf = frequencies.get(term) ?? 0
      if (!tf) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5))
      const denominator = tf + k1 * (1 - b + b * (row.length / Math.max(1, avgLength)))
      lexicalScore += idf * ((tf * (k1 + 1)) / denominator)
    }
    return { ...chunk, lexicalScore }
  }).sort((a, b) => (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0) || a.chunkIndex - b.chunkIndex)
  return ranked.map((chunk, index) => ({ ...chunk, lexicalRank: index + 1 }))
}

export function reciprocalRankFusion(lexical: RankedLibraryChunk[], vector: RankedLibraryChunk[], k = 60): RankedLibraryChunk[] {
  const byKey = new Map<string, RankedLibraryChunk>()
  const keyOf = (chunk: LibraryChunkCandidate) => chunk.chunkId ?? `${chunk.documentId}:${chunk.chunkIndex}`
  for (const chunk of lexical) byKey.set(keyOf(chunk), { ...chunk })
  for (const chunk of vector) byKey.set(keyOf(chunk), { ...(byKey.get(keyOf(chunk)) ?? chunk), ...chunk })
  for (const [index, chunk] of lexical.entries()) {
    const item = byKey.get(keyOf(chunk))!
    item.lexicalRank = chunk.lexicalRank ?? index + 1
    item.lexicalScore = chunk.lexicalScore
  }
  for (const [index, chunk] of vector.entries()) {
    const item = byKey.get(keyOf(chunk))!
    item.vectorRank = chunk.vectorRank ?? index + 1
    item.vectorScore = chunk.vectorScore
  }
  const ranked = [...byKey.values()].map((chunk) => ({
    ...chunk,
    fusedScore: (chunk.lexicalRank ? 1 / (k + chunk.lexicalRank) : 0) + (chunk.vectorRank ? 1 / (k + chunk.vectorRank) : 0),
  })).sort((a, b) => (b.fusedScore ?? 0) - (a.fusedScore ?? 0) || a.chunkIndex - b.chunkIndex)
  return ranked.map((chunk, index) => ({ ...chunk, fusedRank: index + 1 }))
}

function evidenceFromRanked(chunk: RankedLibraryChunk, degraded?: "vector-unavailable"): StructuredLibraryEvidence {
  const chunkId = chunk.chunkId ?? `${chunk.documentId}:${chunk.chunkIndex}`
  const method = chunk.lexicalRank && chunk.vectorRank ? "rrf" : chunk.vectorRank ? "vector" : "bm25"
  return {
    documentId: chunk.documentId,
    chunkId,
    chunkIndex: chunk.chunkIndex,
    mergedChunkIds: [chunkId],
    title: chunk.documentTitle,
    headingPath: chunk.headingPath?.length ? chunk.headingPath : [chunk.section],
    pageNumber: chunk.page ?? null,
    paragraphStart: chunk.paragraphStart ?? null,
    paragraphEnd: chunk.paragraphEnd ?? null,
    text: chunk.content,
    lexicalRank: chunk.lexicalRank ?? null,
    vectorRank: chunk.vectorRank ?? null,
    fusedRank: chunk.fusedRank ?? chunk.lexicalRank ?? chunk.vectorRank ?? 1,
    score: chunk.fusedScore ?? chunk.lexicalScore ?? chunk.vectorScore ?? 0,
    scoreExplanation: {
      method,
      ...(chunk.lexicalScore !== undefined ? { lexicalScore: chunk.lexicalScore } : {}),
      ...(chunk.vectorScore !== undefined ? { vectorScore: chunk.vectorScore } : {}),
      rrfScore: chunk.fusedScore ?? 0,
      ...(degraded ? { degraded } : {}),
    },
  }
}

export function selectStructuredEvidence(
  ranked: RankedLibraryChunk[],
  options: { maxChunks?: number; maxChars?: number; maxChunksPerDocument?: number; mergeAdjacent?: boolean; degraded?: "vector-unavailable" } = {}
): StructuredLibraryEvidence[] {
  const maxChunks = Math.max(1, Math.floor(options.maxChunks ?? 10))
  const maxChars = Math.max(1, Math.floor(options.maxChars ?? 12_000))
  const documentQuota = Math.max(1, Math.floor(options.maxChunksPerDocument ?? 4))
  const selected: Array<{ evidence: StructuredLibraryEvidence; chunkIndex: number }> = []
  const counts = new Map<string, number>()
  const seenText = new Set<string>()
  let usedChars = 0
  for (const chunk of ranked) {
    if (selected.length >= maxChunks) break
    if ((counts.get(chunk.documentId) ?? 0) >= documentQuota) continue
    const normalized = chunk.content.toLowerCase().replace(/\s+/g, " ").trim()
    if (!normalized || seenText.has(normalized) || usedChars + chunk.content.length > maxChars) continue
    seenText.add(normalized)
    counts.set(chunk.documentId, (counts.get(chunk.documentId) ?? 0) + 1)
    selected.push({ evidence: evidenceFromRanked(chunk, options.degraded), chunkIndex: chunk.chunkIndex })
    usedChars += chunk.content.length
  }
  if (options.mergeAdjacent === false) return selected.map((item) => item.evidence)
  const merged: Array<{ evidence: StructuredLibraryEvidence; indices: number[] }> = []
  for (const item of selected) {
    const match = merged.find((candidate) => candidate.evidence.documentId === item.evidence.documentId && candidate.evidence.headingPath.join("/") === item.evidence.headingPath.join("/") && candidate.indices.some((index) => Math.abs(index - item.chunkIndex) === 1))
    if (!match) {
      merged.push({ evidence: item.evidence, indices: [item.chunkIndex] })
      continue
    }
    const before = item.chunkIndex < Math.min(...match.indices)
    match.evidence.text = before ? `${item.evidence.text}\n\n${match.evidence.text}` : `${match.evidence.text}\n\n${item.evidence.text}`
    match.evidence.mergedChunkIds = before ? [...item.evidence.mergedChunkIds, ...match.evidence.mergedChunkIds] : [...match.evidence.mergedChunkIds, ...item.evidence.mergedChunkIds]
    const starts = [match.evidence.paragraphStart, item.evidence.paragraphStart].filter((v): v is number => v != null)
    const ends = [match.evidence.paragraphEnd, item.evidence.paragraphEnd].filter((v): v is number => v != null)
    match.evidence.paragraphStart = starts.length ? Math.min(...starts) : null
    match.evidence.paragraphEnd = ends.length ? Math.max(...ends) : null
    match.indices.push(item.chunkIndex)
  }
  return merged.map((item) => item.evidence)
}

export function retrieveStructuredLibraryEvidence(
  query: string,
  chunks: LibraryChunkCandidate[],
  options: { maxChunks?: number; maxChars?: number; maxChunksPerDocument?: number; vectorResults?: RankedLibraryChunk[]; vectorUnavailable?: boolean } = {}
): StructuredLibraryEvidence[] {
  const lexical = rankLibraryChunksBm25(query, chunks)
  const hasPositiveLexical = lexical.some((chunk) => (chunk.lexicalScore ?? 0) > 0)
  const lexicalCandidates = hasPositiveLexical ? lexical.filter((chunk) => (chunk.lexicalScore ?? 0) > 0) : lexical.slice(0, Math.min(options.maxChunks ?? 10, 4))
  const fused = options.vectorResults?.length ? reciprocalRankFusion(lexicalCandidates, options.vectorResults) : lexicalCandidates.map((chunk, index) => ({ ...chunk, fusedRank: index + 1, fusedScore: 1 / (61 + index) }))
  return selectStructuredEvidence(fused, {
    maxChunks: options.maxChunks,
    maxChars: options.maxChars,
    maxChunksPerDocument: options.maxChunksPerDocument,
    degraded: options.vectorUnavailable ? "vector-unavailable" : undefined,
  })
}

/** Backward-compatible adapter for callers that still consume chunk-shaped results. */
export function retrieveRelevantLibraryChunks(query: string, chunks: LibraryChunkCandidate[], options: { maxChunks?: number; maxChars?: number } = {}): RetrievedLibraryChunk[] {
  return retrieveStructuredLibraryEvidence(query, chunks, { ...options, maxChunksPerDocument: options.maxChunks ?? 10, vectorUnavailable: true }).map((evidence) => ({
    documentId: evidence.documentId,
    chunkId: evidence.chunkId,
    documentTitle: evidence.title,
    chunkIndex: chunks.find((chunk) => (chunk.chunkId ?? `${chunk.documentId}:${chunk.chunkIndex}`) === evidence.chunkId)?.chunkIndex ?? 0,
    section: evidence.headingPath.at(-1) ?? "Document",
    headingPath: evidence.headingPath,
    page: evidence.pageNumber,
    paragraphStart: evidence.paragraphStart,
    paragraphEnd: evidence.paragraphEnd,
    content: evidence.text,
    score: evidence.score,
  }))
}

export function formatStructuredLibraryEvidence(evidence: StructuredLibraryEvidence[], maxTokens = 3_000): string {
  if (!evidence.length) return ""
  const maxChars = Math.max(1, Math.floor(maxTokens * 4))
  const blocks: string[] = []
  let used = 0
  for (const item of evidence) {
    const page = item.pageNumber ? ` p.${item.pageNumber}` : ""
    const heading = item.headingPath.join(" > ")
    const block = `[LIB:${item.documentId}:${item.chunkId}${page}] ${item.title} · ${heading} · chunk ${item.chunkIndex}\n${item.text.trim()}`
    if (used + block.length > maxChars) continue
    blocks.push(block)
    used += block.length
  }
  return blocks.length ? ["[我的文献库：按当前问题召回的结构化证据，不代表完整文档]", ...blocks, "[文献库证据结束]", ""].join("\n\n") : ""
}

export function formatRetrievedLibraryContext(chunks: RetrievedLibraryChunk[]): string {
  return formatStructuredLibraryEvidence(chunks.map((chunk, index) => evidenceFromRanked({ ...chunk, lexicalRank: index + 1, fusedRank: index + 1, fusedScore: chunk.score })))
}
