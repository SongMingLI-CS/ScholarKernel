-- Additive metadata for incremental hybrid Library indexing and durable DAG execution.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "fileHash" TEXT,
  ADD COLUMN IF NOT EXISTS "parserVersion" TEXT NOT NULL DEFAULT 'layout-v1',
  ADD COLUMN IF NOT EXISTS "chunkVersion" TEXT NOT NULL DEFAULT 'semantic-v1',
  ADD COLUMN IF NOT EXISTS "embeddingModelVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "embeddingStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "embeddingUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "indexJobId" TEXT;

ALTER TABLE "DocumentChunk"
  ADD COLUMN IF NOT EXISTS "headingPath" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "paragraphStart" INTEGER,
  ADD COLUMN IF NOT EXISTS "paragraphEnd" INTEGER,
  ADD COLUMN IF NOT EXISTS "contentHash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "embedding" vector(1536),
  ADD COLUMN IF NOT EXISTS "embeddingModelVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "embeddedAt" TIMESTAMP(3);

UPDATE "DocumentChunk"
SET "headingPath" = ARRAY["section"]
WHERE cardinality("headingPath") = 0;

UPDATE "DocumentChunk"
SET "contentHash" = md5("content")
WHERE "contentHash" = '';

CREATE INDEX IF NOT EXISTS "Document_fileHash_idx" ON "Document"("fileHash");
CREATE INDEX IF NOT EXISTS "DocumentChunk_contentHash_idx" ON "DocumentChunk"("contentHash");
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;

ALTER TABLE "AgentJob"
  ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

ALTER TABLE "AgentNode"
  ADD COLUMN IF NOT EXISTS "inputHash" TEXT,
  ADD COLUMN IF NOT EXISTS "upstreamResultHash" TEXT,
  ADD COLUMN IF NOT EXISTS "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "errorCategory" TEXT,
  ADD COLUMN IF NOT EXISTS "outputSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "AgentNode_idempotencyKey_idx" ON "AgentNode"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "AgentJob_status_leaseExpiresAt_idx" ON "AgentJob"("status", "leaseExpiresAt");
