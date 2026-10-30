ALTER TABLE "DocumentChunk"
ADD COLUMN "embedding" JSONB,
ADD COLUMN "embeddingModel" TEXT,
ADD COLUMN "embeddingRevision" TEXT;
