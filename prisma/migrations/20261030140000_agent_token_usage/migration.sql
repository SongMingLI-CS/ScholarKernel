ALTER TABLE "TokenAuditLog" ADD COLUMN "agentId" TEXT;

CREATE INDEX "TokenAuditLog_userId_agentId_createdAt_idx" ON "TokenAuditLog"("userId", "agentId", "createdAt");
