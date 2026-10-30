ALTER TYPE "AgentJobStatus" ADD VALUE 'waiting_for_input';
ALTER TYPE "AgentJobStatus" ADD VALUE 'completed';
ALTER TYPE "AgentJobStatus" ADD VALUE 'failed';
ALTER TABLE "AgentJob"
  ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "workflowVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "runConfig" JSONB,
  ADD COLUMN "conversationId" TEXT,
  ADD COLUMN "assistantMessageId" TEXT,
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "eventSequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "completedAt" TIMESTAMP(3);
CREATE TABLE "AgentJobEvent" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentJobEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentJobEvent_jobId_sequence_key" ON "AgentJobEvent"("jobId", "sequence");
CREATE INDEX "AgentJob_executionMode_status_leaseExpiresAt_createdAt_idx" ON "AgentJob"("executionMode", "status", "leaseExpiresAt", "createdAt");
ALTER TABLE "AgentJobEvent" ADD CONSTRAINT "AgentJobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AgentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
