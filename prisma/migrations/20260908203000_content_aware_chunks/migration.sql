-- Additive content classification for table/formula/reference-aware chunk budgets.
ALTER TABLE "DocumentChunk"
  ADD COLUMN IF NOT EXISTS "contentKind" TEXT NOT NULL DEFAULT 'text';

UPDATE "DocumentChunk"
SET "contentKind" = 'references'
WHERE lower("section") IN ('references', 'bibliography');
