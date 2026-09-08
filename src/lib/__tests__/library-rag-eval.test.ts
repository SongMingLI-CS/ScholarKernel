import { performance } from "node:perf_hooks"
import { describe, expect, it } from "vitest"

import { libraryRagBenchmarkCases, libraryRagBenchmarkChunks } from "@/lib/__fixtures__/library-rag-benchmark"
import { retrieveStructuredLibraryEvidence } from "@/lib/library-rag"

function legacyTerms(text: string): Set<string> {
  const normalized = text.toLowerCase()
  const out = new Set(normalized.match(/[a-z0-9][a-z0-9_-]{1,}|[\u3400-\u9fff]/g) ?? [])
  const cjk = [...normalized].filter((char) => /[\u3400-\u9fff]/.test(char))
  for (let index = 0; index + 1 < cjk.length; index++) out.add(`${cjk[index]}${cjk[index + 1]}`)
  return out
}

type EvaluationResult = { ids: string[]; chars: number; citationsValid: boolean }

function legacyRetrieve(query: string): EvaluationResult {
  const queryTerms = legacyTerms(query)
  const retrieved = libraryRagBenchmarkChunks.map((chunk) => {
    const contentTerms = legacyTerms(`${chunk.documentTitle} ${chunk.section} ${chunk.content}`)
    const titleTerms = legacyTerms(chunk.documentTitle)
    const matches = [...queryTerms].filter((term) => contentTerms.has(term)).length
    const titleMatches = [...queryTerms].filter((term) => titleTerms.has(term)).length
    return { ...chunk, score: matches / Math.sqrt(Math.max(1, contentTerms.size)) + titleMatches * 0.75 }
  }).sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex).filter((chunk) => chunk.score > 0).slice(0, 10)
  return {
    ids: retrieved.map((chunk) => chunk.chunkId ?? `${chunk.documentId}:${chunk.chunkIndex}`),
    chars: retrieved.reduce((sum, chunk) => sum + chunk.content.length, 0),
    citationsValid: retrieved.every((chunk) => Boolean(chunk.documentId && chunk.chunkId && chunk.headingPath?.length && chunk.page)),
  }
}

function currentRetrieve(query: string): EvaluationResult {
  const retrieved = retrieveStructuredLibraryEvidence(query, libraryRagBenchmarkChunks, { vectorUnavailable: true, maxChunks: 10 })
  return {
    ids: retrieved.flatMap((evidence) => evidence.mergedChunkIds),
    chars: retrieved.reduce((sum, evidence) => sum + evidence.text.length, 0),
    citationsValid: retrieved.every((evidence) => Boolean(evidence.documentId && evidence.chunkId && evidence.headingPath.length && evidence.pageNumber)),
  }
}

function evaluate(retrieve: (query: string) => EvaluationResult) {
  let recall5 = 0
  let recall10 = 0
  let reciprocalRank = 0
  let citationCases = 0
  let validCitationCases = 0
  let incorrectTop1 = 0
  let humanTop1 = 0
  let noAnswerCitations = 0
  let retrievedChars = 0
  const categoryRecall = new Map<string, { found: number; total: number }>()
  const answerable = libraryRagBenchmarkCases.filter((item) => item.relevantChunkIds.length)
  const noAnswer = libraryRagBenchmarkCases.filter((item) => !item.relevantChunkIds.length)
  const startedAt = performance.now()
  for (const evalCase of libraryRagBenchmarkCases) {
    const retrieved = retrieve(evalCase.query)
    retrievedChars += retrieved.chars
    if (!evalCase.relevantChunkIds.length) {
      if (retrieved.ids.length) noAnswerCitations += 1
      continue
    }
    citationCases += 1
    if (retrieved.citationsValid) validCitationCases += 1
    const relevant = new Set(evalCase.relevantChunkIds)
    recall5 += evalCase.relevantChunkIds.filter((id) => retrieved.ids.slice(0, 5).includes(id)).length / relevant.size
    recall10 += evalCase.relevantChunkIds.filter((id) => retrieved.ids.slice(0, 10).includes(id)).length / relevant.size
    const firstRank = retrieved.ids.findIndex((id) => relevant.has(id))
    if (firstRank >= 0) reciprocalRank += 1 / (firstRank + 1)
    if (!relevant.has(retrieved.ids[0] ?? "")) incorrectTop1 += 1
    humanTop1 += (evalCase.humanRelevance[retrieved.ids[0] ?? ""] ?? 0) / 3
    const category = categoryRecall.get(evalCase.category) ?? { found: 0, total: 0 }
    category.found += firstRank >= 0 ? 1 : 0
    category.total += 1
    categoryRecall.set(evalCase.category, category)
  }
  return {
    cases: libraryRagBenchmarkCases.length,
    answerableCases: answerable.length,
    noAnswerCases: noAnswer.length,
    recallAt5: Number((recall5 / answerable.length).toFixed(4)),
    recallAt10: Number((recall10 / answerable.length).toFixed(4)),
    mrr: Number((reciprocalRank / answerable.length).toFixed(4)),
    citationMetadataHitRate: Number((validCitationCases / citationCases).toFixed(4)),
    incorrectTop1CitationRate: Number((incorrectTop1 / answerable.length).toFixed(4)),
    noAnswerCitationRate: Number((noAnswerCitations / noAnswer.length).toFixed(4)),
    retrievalEvidenceCoverage: Number((recall10 / answerable.length).toFixed(4)),
    answerEvidenceCoverage: "unmeasured-no-fixed-answer-generator",
    humanGradedTop1: Number((humanTop1 / answerable.length).toFixed(4)),
    categoryHitRate: Object.fromEntries([...categoryRecall].map(([category, value]) => [category, Number((value.found / value.total).toFixed(4))])),
    retrievalLatencyMs: Number((performance.now() - startedAt).toFixed(3)),
    estimatedContextTokens: Math.ceil(retrievedChars / 4),
    paidQueryCostUsd: 0,
  }
}

describe("Library RAG 130-question benchmark", () => {
  it("reports quality, safety, latency, and human relevance labels before and after", () => {
    expect(libraryRagBenchmarkCases).toHaveLength(130)
    const before = evaluate(legacyRetrieve)
    const after = evaluate(currentRetrieve)
    console.info("LIBRARY_RAG_BENCHMARK", JSON.stringify({ before, after }))

    expect(after.recallAt10).toBeGreaterThan(before.recallAt10)
    expect(after.mrr).toBeGreaterThan(before.mrr)
    expect(after.citationMetadataHitRate).toBe(1)
    expect(after.noAnswerCitationRate).toBe(0)
    expect(after.humanGradedTop1).toBeGreaterThanOrEqual(0.9)
  })
})
