-- CreateEnum
CREATE TYPE "AgentJobStatus" AS ENUM ('pending', 'running', 'done', 'error');

-- AlterTable: migrate status string -> enum, add observability columns
ALTER TABLE "AgentJob" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "AgentJob" ADD COLUMN IF NOT EXISTS "errorStack" TEXT;

UPDATE "AgentJob" SET "errorMessage" = "error" WHERE "errorMessage" IS NULL AND "error" IS NOT NULL;

ALTER TABLE "AgentJob" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "AgentJob" ALTER COLUMN "status" TYPE "AgentJobStatus" USING (
  CASE "status"
    WHEN 'pending' THEN 'pending'::"AgentJobStatus"
    WHEN 'running' THEN 'running'::"AgentJobStatus"
    WHEN 'done' THEN 'done'::"AgentJobStatus"
    WHEN 'error' THEN 'error'::"AgentJobStatus"
    ELSE 'pending'::"AgentJobStatus"
  END
);
ALTER TABLE "AgentJob" ALTER COLUMN "status" SET DEFAULT 'pending'::"AgentJobStatus";
