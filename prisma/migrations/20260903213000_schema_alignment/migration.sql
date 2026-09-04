-- Align databases created exclusively from the historical migration chain with
-- the current Prisma schema. The original "Document" table stored Canvas data;
-- preserve it by renaming it before creating the global Library table.
DO $$
BEGIN
  IF to_regclass('public."CanvasDocument"') IS NULL
     AND EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'Document'
         AND column_name = 'conversationId'
     ) THEN
    ALTER TABLE "Document" RENAME TO "CanvasDocument";
    ALTER TABLE "CanvasDocument" RENAME CONSTRAINT "Document_pkey" TO "CanvasDocument_pkey";
    ALTER TABLE "CanvasDocument" RENAME CONSTRAINT "Document_conversationId_fkey" TO "CanvasDocument_conversationId_fkey";
    ALTER INDEX IF EXISTS "Document_conversationId_updatedAt_idx" RENAME TO "CanvasDocument_conversationId_updatedAt_idx";

    -- The earlier indexing migration attached this table to the legacy Canvas
    -- table. Keep any rows intact under a compatibility name and create the
    -- correctly related Library chunk table below.
    IF to_regclass('public."DocumentChunk"') IS NOT NULL THEN
      ALTER TABLE "DocumentChunk" RENAME TO "LegacyCanvasDocumentChunk";
      ALTER TABLE "LegacyCanvasDocumentChunk" RENAME CONSTRAINT "DocumentChunk_pkey" TO "LegacyCanvasDocumentChunk_pkey";
      ALTER TABLE "LegacyCanvasDocumentChunk" RENAME CONSTRAINT "DocumentChunk_documentId_fkey" TO "LegacyCanvasDocumentChunk_documentId_fkey";
      ALTER INDEX IF EXISTS "DocumentChunk_documentId_chunkIndex_key" RENAME TO "LegacyCanvasDocumentChunk_documentId_chunkIndex_key";
      ALTER INDEX IF EXISTS "DocumentChunk_documentId_idx" RENAME TO "LegacyCanvasDocumentChunk_documentId_idx";
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "Document" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "fileUrl" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "fileType" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "folders" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "indexStatus" TEXT NOT NULL DEFAULT 'pending',
  "indexError" TEXT,
  "indexedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Document_userId_idx" ON "Document"("userId");

CREATE TABLE IF NOT EXISTS "DocumentChunk" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "section" TEXT NOT NULL,
  "page" INTEGER,
  "content" TEXT NOT NULL,
  "charCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "DocumentChunk_documentId_chunkIndex_key" ON "DocumentChunk"("documentId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");

CREATE TABLE IF NOT EXISTS "AgentNode" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "status" "AgentJobStatus" NOT NULL DEFAULT 'pending',
  "outputs" JSONB,
  "nodeSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentNode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentNode_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AgentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentNode_jobId_nodeId_key" ON "AgentNode"("jobId", "nodeId");
CREATE INDEX IF NOT EXISTS "AgentNode_jobId_status_idx" ON "AgentNode"("jobId", "status");

CREATE TABLE IF NOT EXISTS "UserBilling" (
  "userId" TEXT NOT NULL,
  "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "tokenQuota" INTEGER NOT NULL DEFAULT 500000,
  "tokenUsed" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserBilling_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "UserBilling_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TokenAuditLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "jobId" TEXT,
  "modelUsed" TEXT NOT NULL,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "calculatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ttftMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TokenAuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TokenAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "TokenAuditLog_userId_createdAt_idx" ON "TokenAuditLog"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "TokenAuditLog_userId_jobId_idx" ON "TokenAuditLog"("userId", "jobId");
