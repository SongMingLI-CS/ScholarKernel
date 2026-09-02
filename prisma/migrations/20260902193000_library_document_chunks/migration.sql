-- Additive Library indexing metadata; existing documents remain valid and are lazily indexed.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "indexStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "indexError" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "indexedAt" TIMESTAMP(3);

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
