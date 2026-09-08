import { performance } from "node:perf_hooks"
import { describe, expect, it } from "vitest"

import { libraryRagEvalCases, libraryRagEvalChunks } from "@/lib/__fixtures__/library-rag-eval"
import { retrieveRelevantLibraryChunks } from "@/lib/library-rag"

function legacyTerms(text: string): Set<string> {
  const normalized = text.toLowerCase()
  const out = new Set(normalized.match(/[a-z0-9][a-z0-9_-]{1,}|[\u3400-\u9fff]/g) ?? [])
  const cjk = [...normalized].filter((char) => /[\u3400-\u9fff]/.test(char))
  for (let index = 0; index + 1 < cjk.length; index++) out.add(`${cjk[index]}${cjk[index + 1]}`)
  return out
}

function legacyRetrieve(query: string) {
  const queryTerms = legacyTerms(query)
  return libraryRagEvalChunks.map((chunk) => {
    const contentTerms = legacyTerms(`${chunk.documentTitle} ${chunk.section} ${chunk.content}`)
    const titleTerms = legacyTerms(chunk.documentTitle)
    const matches = [...queryTerms].filter((term) => contentTerms.has(term)).length
    const titleMatches = [...queryTerms].filter((term) => titleTerms.has(term)).length
    return { ...chunk, score: matches / Math.sqrt(Math.max(1, contentTerms.size)) + titleMatches * 0.75 }
  }).sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex).filter((chunk) => chunk.score > 0).slice(0, 10)
}

function evaluate(retrieve: (query: string) => typeof libraryRagEvalChunks) {
  let hits = 0
  let citationHits = 0
  let retrievedChars = 0
  const startedAt = performance.now()
  for (const evalCase of libraryRagEvalCases) {
    const retrieved = retrieve(evalCase.query)
    const ids = new Set(retrieved.map((chunk) => chunk.chunkId ?? `${chunk.documentId}:${chunk.chunkIndex}`))
    if (evalCase.relevantChunkIds.some((id) => ids.has(id))) hits += 1
    if (retrieved.every((chunk) => chunk.documentId && chunk.section && chunk.chunkIndex >= 0)) citationHits += 1
    retrievedChars += retrieved.reduce((sum, chunk) => sum + chunk.content.length, 0)
  }
  return {
    cases: libraryRagEvalCases.length,
    recallAt10: hits / libraryRagEvalCases.length,
    citationHitRate: citationHits / libraryRagEvalCases.length,
    answerEvidenceCoverage: "unmeasured-no-answer-generator",
    retrievalLatencyMs: Number((performance.now() - startedAt).toFixed(3)),
    estimatedContextTokens: Math.ceil(retrievedChars / 4),
    paidQueryCostUsd: 0,
  }
}

describe("Library RAG repeatable baseline", () => {
  it("reports retrieval quality, latency, and deterministic query cost", () => {
    const before = evaluate(legacyRetrieve)
    const after = evaluate((query) => retrieveRelevantLibraryChunks(query, libraryRagEvalChunks, {
        maxChunks: 10,
        maxChars: 12_000,
      }))
    console.info("LIBRARY_RAG_EVAL", JSON.stringify({ before, after }))

    expect(after.recallAt10).toBeGreaterThanOrEqual(before.recallAt10)
    expect(after.recallAt10).toBeGreaterThanOrEqual(0.75)
    expect(after.citationHitRate).toBe(1)
  })
})
