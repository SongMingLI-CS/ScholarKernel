-- Complete the current Canvas schema using additive, repeatable operations.
ALTER TABLE "CanvasDocument"
  ADD COLUMN IF NOT EXISTS "isShared" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "shareToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CanvasDocument_shareToken_key"
  ON "CanvasDocument"("shareToken");
