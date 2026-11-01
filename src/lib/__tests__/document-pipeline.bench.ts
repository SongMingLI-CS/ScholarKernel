import { bench, describe } from "vitest"

import { semanticChunkAcademicText, formatAcademicChunksForContext } from "@/lib/document/academic-semantic-chunker"
import { applyColumnReorder } from "@/lib/document/column-reorder"
import { dedupeAcademicHits, lexicalRerankScores, sanitizeRerankScores } from "@/lib/document/rerank-gateway"
import { normalizeAcademicFormulas } from "@/lib/document/formula-normalizer"
import type { AcademicSearchHit } from "@/lib/tools/search-tool"

/**
 * 文档流水线性能基线（纯 CPU，无网络、无数据库）。
 *
 * 运行：npx vitest bench --run
 * 说明：固定输入规模，热身后多次采样；报告中位数与 hz，便于回归对比。
 */
function buildPaper(targetChars: number): string {
  const names = ["Abstract", "Introduction", "Related Work", "Methodology", "Experiments", "Results", "Discussion", "Conclusion", "Appendix"]
  const parts: string[] = []
  let size = 0
  let s = 0
  while (size < targetChars) {
    const name = names[s % names.length]!
    const lines = [`# ${name} ${s}`]
    for (let i = 0; i < 40; i++) {
      lines.push(
        `段落 ${i}（${name}）讨论了注意力机制、稀疏路由、检索增强生成与重排序的实验结果，公式 $E = mc^2$ 与 α + β 一并给出。`
      )
    }
    const block = lines.join("\n")
    parts.push(block)
    size += block.length
    s++
  }
  return parts.join("\n\n")
}

const PAPER_MEDIUM = buildPaper(200_000)
const PAPER_LARGE = buildPaper(800_000)
// 正文型输入：不含任何 Unicode 数学符号，代表最常见的上传文档
const PAPER_PLAIN = PAPER_MEDIUM.replace(/α \+ β/g, "and").replace(/公式 \$E = mc\^2\$ 与/g, "以及")
console.log(
  `[bench] PAPER_MEDIUM=${PAPER_MEDIUM.length} chars, PAPER_LARGE=${PAPER_LARGE.length} chars, PAPER_PLAIN=${PAPER_PLAIN.length} chars`
)
const QUERY = "transformer attention retrieval reranking sparse routing"

const HITS: AcademicSearchHit[] = Array.from({ length: 28 }, (_, i) => ({
  source_id: String(i + 1),
  title: i % 4 === 0 ? "Attention is all you need: transformer architecture" : `Paper ${i} on unrelated topic`,
  url: `https://ex.test/${i}`,
  snippet: "dense retrieval and reranking baseline",
}))

const DUPLICATED_HITS: AcademicSearchHit[] = [...HITS, ...HITS.map((h) => ({ ...h, url: `${h.url}?dup=1` }))]

const BLOCKS = Array.from({ length: 200 }, (_, i) => ({
  text: `Block ${i} left column body text about layout parsing.`,
  x: i % 2 === 0 ? 50 : 330,
  y: 700 - Math.floor(i / 2) * 14,
  page: 1 + Math.floor(i / 40),
}))

describe("document pipeline", () => {
  bench("semanticChunk ~200KB text (9x40-line sections)", () => {
    semanticChunkAcademicText({ text: PAPER_MEDIUM })
  })

  bench("semanticChunk ~800KB text", () => {
    semanticChunkAcademicText({ text: PAPER_LARGE })
  })

  bench("formatAcademicChunksForContext", () => {
    const chunks = semanticChunkAcademicText({ text: PAPER_MEDIUM })
    formatAcademicChunksForContext(chunks, chunks.length)
  })

  bench("columnReorder with 200 layout blocks", () => {
    applyColumnReorder("", BLOCKS, [{ page: 1, width: 612 }])
  })

  bench("normalizeAcademicFormulas on 200k chars", () => {
    normalizeAcademicFormulas(PAPER_MEDIUM)
  })

  bench("normalizeAcademicFormulas on 200KB plain prose (no math)", () => {
    normalizeAcademicFormulas(PAPER_PLAIN)
  })
})

describe("retrieval reranking", () => {
  bench("lexicalRerankScores 28 docs", () => {
    lexicalRerankScores(QUERY, HITS.map((h) => `${h.title}\n${h.snippet}\n${h.url}`))
  })

  bench("dedupe + sanitize on 56 candidates", () => {
    const deduped = dedupeAcademicHits(DUPLICATED_HITS)
    sanitizeRerankScores(
      deduped.map((_, i) => ({ index: i, score: 1 / (i + 1) })),
      deduped.length
    )
  })
})
