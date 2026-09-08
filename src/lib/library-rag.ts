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
  contentKind?: "text" | "table" | "formula" | "references"
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
  contentKind: "text" | "table" | "formula" | "references"
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
  for (const sequence of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    const chars = [...sequence]
    for (let index = 0; index + 1 < chars.length; index++) terms.push(`${chars[index]}${chars[index + 1]}`)
  }
  const bilingualTerms: Array<[string, string]> = [
    ["自注意力", "self attention"], ["序列复杂度", "sequential complexity"], ["掩码语言模型", "masked language model"],
    ["双向预训练", "bidirectional pretraining"], ["图像块", "image patch"], ["残差连接", "residual connection"],
    ["消息传递", "message passing"], ["过平滑", "oversmoothing"], ["对比学习", "contrastive learning"],
    ["零样本", "zero shot"], ["蛋白质结构", "protein structure"], ["扩散模型", "diffusion model"],
    ["低秩适配", "low rank adaptation"], ["检索增强", "retrieval augmented"], ["非参数记忆", "non parametric memory"],
    ["因果推断", "causal inference"], ["强化学习", "reinforcement learning"], ["联邦学习", "federated learning"],
    ["可复现实验", "reproducible experiment"], ["随机种子", "random seeds"], ["数据划分", "dataset splits"],
    ["置信区间", "confidence intervals"], ["方差", "variance"], ["模型扩展", "model scaling"],
    ["有限训练数据", "limited training data"], ["过拟合", "overfitting"], ["矛盾证据", "conflicting evidence"],
  ]
  for (const [phrase, expansion] of bilingualTerms) {
    if (normalized.includes(phrase)) terms.push(...(expansion.match(/[a-z0-9][a-z0-9_-]{1,}/g) ?? []))
  }
  const aliases: Array<[RegExp, string[]]> = [
    [/\breproducibility\b/, ["reproducible"]], [/\buncertainty\b/, ["variance", "confidence"]],
    [/\bevaluation\b/, ["experimental", "results"]], [/\bscales?\b/, ["scaling"]],
  ]
  for (const [pattern, expansion] of aliases) if (pattern.test(normalized)) terms.push(...expansion)
  return terms
}

export function libraryRetrievalPolicy(query: string): {
  candidateLimit: number
  rrfK: number
  maxChunks: number
  maxChunksPerDocument: number
} {
  const length = new Set(tokenizeLibraryText(query)).size
  if (length <= 3) return { candidateLimit: 30, rrfK: 50, maxChunks: 8, maxChunksPerDocument: 3 }
  if (length >= 9) return { candidateLimit: 60, rrfK: 75, maxChunks: 12, maxChunksPerDocument: 5 }
  return { candidateLimit: 40, rrfK: 60, maxChunks: 10, maxChunksPerDocument: 4 }
}

/** Deterministic in-memory BM25, retained as the lexical retrieval path. */
export function rankLibraryChunksBm25(query: string, chunks: LibraryChunkCandidate[]): RankedLibraryChunk[] {
  const queryTerms = [...new Set(tokenizeLibraryText(query))]
  if (!chunks.length) return []
  const tokenized = chunks.map((chunk) => ({
    title: tokenizeLibraryText(chunk.documentTitle),
    heading: tokenizeLibraryText((chunk.headingPath?.length ? chunk.headingPath : [chunk.section]).join(" ")),
    content: tokenizeLibraryText(chunk.content),
  }))
  const avgLength = tokenized.reduce((sum, row) => sum + row.content.length, 0) / Math.max(1, tokenized.length)
  const documentFrequency = new Map<string, number>()
  for (const row of tokenized) for (const term of new Set([...row.title, ...row.heading, ...row.content])) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  const k1 = 1.2
  const b = 0.75
  const ranked = chunks.map((chunk, index) => {
    const row = tokenized[index] ?? { title: [], heading: [], content: [] }
    const frequency = (values: string[], term: string) => values.reduce((sum, value) => sum + Number(value === term), 0)
    let lexicalScore = 0
    for (const term of queryTerms) {
      const tf = frequency(row.content, term) + frequency(row.heading, term) * 2 + frequency(row.title, term) * 3
      if (!tf) continue
      const df = documentFrequency.get(term) ?? 0
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5))
      const denominator = tf + k1 * (1 - b + b * (row.content.length / Math.max(1, avgLength)))
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
    contentKind: chunk.contentKind ?? "text",
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
  const policy = libraryRetrievalPolicy(query)
  const lexical = rankLibraryChunksBm25(query, chunks)
  const lexicalCandidates = lexical.filter((chunk) => (chunk.lexicalScore ?? 0) > 0).slice(0, policy.candidateLimit)
  const fused = options.vectorResults?.length ? reciprocalRankFusion(lexicalCandidates, options.vectorResults.slice(0, policy.candidateLimit), policy.rrfK) : lexicalCandidates.map((chunk, index) => ({ ...chunk, fusedRank: index + 1, fusedScore: 1 / (policy.rrfK + 1 + index) }))
  return selectStructuredEvidence(fused, {
    maxChunks: options.maxChunks ?? policy.maxChunks,
    maxChars: options.maxChars,
    maxChunksPerDocument: options.maxChunksPerDocument ?? policy.maxChunksPerDocument,
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
    contentKind: evidence.contentKind,
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
