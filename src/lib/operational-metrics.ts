export type OperationalMetric = {
  name: "library.retrieval" | "library.embedding" | "agent.node" | "agent.dag" | "agent.lease_recovery"
  timestamp?: string
  durationMs?: number
  lexicalMs?: number
  vectorMs?: number
  lexicalCandidates?: number
  vectorCandidates?: number
  selectedEvidence?: number
  degradedReason?: string
  documentCount?: number
  chunkCount?: number
  embeddingRequests?: number
  estimatedTokens?: number
  costUsd?: number | null
  status?: string
  nodeType?: string
  attemptCount?: number
  retryCount?: number
  maxConcurrent?: number
  completedNodes?: number
  errorCategory?: string
  recoveredJobs?: number
}

type MetricSink = (metric: OperationalMetric) => void

const ALLOWED_FIELDS = new Set<keyof OperationalMetric>([
  "name", "timestamp", "durationMs", "lexicalMs", "vectorMs", "lexicalCandidates", "vectorCandidates",
  "selectedEvidence", "degradedReason", "documentCount", "chunkCount", "embeddingRequests", "estimatedTokens",
  "costUsd", "status", "nodeType", "attemptCount", "retryCount", "maxConcurrent", "completedNodes",
  "errorCategory", "recoveredJobs",
])

let testSink: MetricSink | undefined

export function setOperationalMetricSinkForTests(sink: MetricSink | undefined): void {
  testSink = sink
}

export function recordOperationalMetric(metric: OperationalMetric): void {
  const safe = Object.fromEntries(Object.entries(metric).filter(([key, value]) => {
    if (!ALLOWED_FIELDS.has(key as keyof OperationalMetric)) return false
    if (value === null) return true
    if (typeof value === "number") return Number.isFinite(value)
    return typeof value === "string" || typeof value === "boolean"
  })) as OperationalMetric
  safe.timestamp = metric.timestamp ?? new Date().toISOString()
  if (testSink) {
    testSink(safe)
  } else if (process.env.OPERATIONAL_METRICS_ENABLED === "1") {
    console.info("[operational-metric]", JSON.stringify(safe))
  }
}
