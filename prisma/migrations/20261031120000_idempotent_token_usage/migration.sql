ALTER TABLE "TokenAuditLog" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "TokenAuditLog_idempotencyKey_key" ON "TokenAuditLog"("idempotencyKey");
