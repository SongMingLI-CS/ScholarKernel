import { randomUUID } from "node:crypto"
import { buildDocumentChunkRows } from "../../src/lib/document/document-chunk-index"
import { searchConversationDocumentChunks } from "../../src/lib/document/search-conversation-chunks"
import { prisma } from "../../src/lib/prisma"

type QueryFixture = { query: string; targetIndex: number }
const FIXTURES: QueryFixture[] = [
  { query: "mitochondrial calcium transporter", targetIndex: 4990 },
  { query: "single cell sequencing tumor resistance", targetIndex: 4991 },
  { query: "microbiome cognitive behavior gut brain axis", targetIndex: 4992 },
  { query: "childhood asthma climate exposure", targetIndex: 4993 },
  { query: "adenosine receptor immune inflammation", targetIndex: 4994 },
  { query: "纳米光谱电池界面反应", targetIndex: 4995 },
  { query: "腺苷受体免疫炎症", targetIndex: 4996 },
  { query: "脑肠轴微生物认知行为", targetIndex: 4997 },
  { query: "单细胞测序肿瘤耐药", targetIndex: 4998 },
  { query: "气候暴露儿童哮喘发病", targetIndex: 4999 },
]
const TARGET_TEXT = new Map<number, string>([
  [4990, "Mitochondrial calcium transporter regulates cellular energy homeostasis."],
  [4991, "Single-cell sequencing reveals tumor treatment resistance heterogeneity."],
  [4992, "Gut-brain axis microbiome changes influence cognitive and behavioral outcomes."],
  [4993, "Climate-related exposure is associated with childhood asthma risk and onset."],
  [4994, "Adenosine receptor signaling regulates immune-mediated inflammation."],
  [4995, "跨学科纳米光谱表征用于电池界面反应的实验证据。"],
  [4996, "腺苷受体调控免疫介导的炎症反应。"],
  [4997, "脑肠轴微生物群变化影响认知与行为。"],
  [4998, "单细胞测序揭示肿瘤治疗耐药的细胞异质性。"],
  [4999, "气候相关暴露与儿童哮喘风险及发病相关。"],
])

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0
}

async function measure<T>(callback: () => Promise<T>) {
  const baselineRss = process.memoryUsage().rss
  let peakRss = baselineRss
  const sampler = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss) }, 5)
  const started = performance.now()
  try {
    const value = await callback()
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    return { value, elapsedMs: performance.now() - started, peakRssDeltaBytes: Math.max(0, peakRss - baselineRss) }
  } finally {
    clearInterval(sampler)
  }
}

async function main() {
  delete process.env.LOCAL_EMBEDDING_API_URL
  delete process.env.LOCAL_RERANKER_API_URL
  const userId = `phase6-rag-${randomUUID()}`
  const user = await prisma.user.create({ data: { id: userId } })
  const conversation = await prisma.conversation.create({ data: { userId: user.id, title: "Phase 6 synthetic RAG index comparison" } })
  try {
    const document = await prisma.document.create({ data: { conversationId: conversation.id, title: "Synthetic 5,000 chunk multilingual corpus", content: "" } })
    const chunks = Array.from({ length: 5000 }, (_, index) => ({
      text: TARGET_TEXT.get(index) ?? `Unrelated synthetic control passage with identifier ${index}.`,
      metadata: { section: "Results", index },
    }))
    const rows = buildDocumentChunkRows(document.id, document.content, chunks)
    await prisma.documentChunk.createMany({ data: rows })
    const targetIds = new Map(FIXTURES.map(({ targetIndex }) => [targetIndex, rows[targetIndex]!.id]))

    const currentTimes: number[] = []
    const currentMemory: number[] = []
    const currentHits = new Map<string, { found: boolean; topChunkId?: string }>()
    for (let run = 0; run < 5; run++) {
      for (const fixture of FIXTURES) {
        const measured = await measure(() => searchConversationDocumentChunks(userId, conversation.id, fixture.query, 8))
        currentTimes.push(measured.elapsedMs)
        currentMemory.push(measured.peakRssDeltaBytes)
        currentHits.set(fixture.query, {
          found: measured.value.some(hit => hit.chunkId === targetIds.get(fixture.targetIndex)),
          topChunkId: measured.value[0]?.chunkId,
        })
      }
    }

    const fullText = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE phase6_rag_fts (id text PRIMARY KEY, content text NOT NULL, search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED)`)
      const payload = JSON.stringify(rows.map(row => ({ id: row.id, content: row.content })))
      await tx.$executeRaw`INSERT INTO phase6_rag_fts (id, content) SELECT item.id, item.content FROM jsonb_to_recordset(${payload}::jsonb) AS item(id text, content text)`
      await tx.$executeRawUnsafe("CREATE INDEX phase6_rag_fts_gin ON phase6_rag_fts USING GIN(search_vector)")
      await tx.$executeRawUnsafe("ANALYZE phase6_rag_fts")
      const plan = await tx.$queryRaw<Array<{ "QUERY PLAN": string }>>`EXPLAIN SELECT id FROM phase6_rag_fts WHERE search_vector @@ plainto_tsquery('simple', ${FIXTURES[0]!.query}) ORDER BY ts_rank(search_vector, plainto_tsquery('simple', ${FIXTURES[0]!.query})) DESC, id ASC LIMIT 8`
      const queryTimes: number[] = []
      const memoryDeltas: number[] = []
      const hits = new Map<string, { found: boolean; topChunkId?: string }>()
      for (let run = 0; run < 5; run++) {
        for (const fixture of FIXTURES) {
          const measured = await measure(() => tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM phase6_rag_fts WHERE search_vector @@ plainto_tsquery('simple', ${fixture.query}) ORDER BY ts_rank(search_vector, plainto_tsquery('simple', ${fixture.query})) DESC, id ASC LIMIT 8`)
          queryTimes.push(measured.elapsedMs)
          memoryDeltas.push(measured.peakRssDeltaBytes)
          hits.set(fixture.query, {
            found: measured.value.some(hit => hit.id === targetIds.get(fixture.targetIndex)),
            topChunkId: measured.value[0]?.id,
          })
        }
      }
      const sizes = await tx.$queryRaw<Array<{ table_bytes: bigint; index_bytes: bigint }>>`SELECT pg_relation_size('phase6_rag_fts'::regclass) AS table_bytes, pg_relation_size('phase6_rag_fts_gin'::regclass) AS index_bytes`
      return {
        hits,
        p50Ms: percentile(queryTimes, 0.5),
        p95Ms: percentile(queryTimes, 0.95),
        peakRssDeltaBytesP95: percentile(memoryDeltas, 0.95),
        queryPlan: plan.map(row => row["QUERY PLAN"]),
        tableBytes: Number(sizes[0]?.table_bytes ?? 0),
        indexBytes: Number(sizes[0]?.index_bytes ?? 0),
      }
    })

    const summarize = (hits: Map<string, { found: boolean; topChunkId?: string }>) => ({
      queryCount: hits.size,
      targetRecallAt8: [...hits.values()].filter(hit => hit.found).length / hits.size,
      queriesWithTargetAt8: [...hits.values()].filter(hit => hit.found).length,
      perQuery: FIXTURES.map(fixture => ({
        query: fixture.query,
        language: /[\u3400-\u9fff]/u.test(fixture.query) ? "Chinese" : "English",
        targetIndex: fixture.targetIndex,
        targetInTop8: hits.get(fixture.query)?.found ?? false,
        topChunkId: hits.get(fixture.query)?.topChunkId,
      })),
    })
    console.info(JSON.stringify({
      environment: { node: process.version, platform: process.platform, arch: process.arch, postgres: "isolated PostgreSQL", rows: rows.length, queryCount: FIXTURES.length, rssSampleIntervalMs: 5, repetitionsPerQuery: 5 },
      currentBM25TwoScan: {
        accuracy: summarize(currentHits),
        p50MsPerQuery: Number(percentile(currentTimes, 0.5).toFixed(2)), p95MsPerQuery: Number(percentile(currentTimes, 0.95).toFixed(2)),
        peakRssDeltaBytesP95: percentile(currentMemory, 0.95),
        currentApplicationIndexOverheadBytes: 0,
      },
      postgresGinSimpleFTS: {
        accuracy: summarize(fullText.hits), p50MsPerQuery: Number(fullText.p50Ms.toFixed(2)), p95MsPerQuery: Number(fullText.p95Ms.toFixed(2)),
        peakRssDeltaBytesP95: fullText.peakRssDeltaBytesP95,
        temporaryTableBytes: fullText.tableBytes, ginIndexBytes: fullText.indexBytes,
        explainFirstEnglishQuery: fullText.queryPlan,
      },
      note: "Synthetic task coverage only; five runs per query; FTS uses PostgreSQL simple dictionary and does not stem or segment Chinese.",
    }, null, 2))
  } finally {
    await prisma.user.delete({ where: { id: userId } })
    await prisma.$disconnect()
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
