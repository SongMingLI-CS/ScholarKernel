-- CreateTable
CREATE TABLE "UserBilling" (
    "userId" TEXT NOT NULL,
    "totalSpent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tokenQuota" INTEGER NOT NULL DEFAULT 500000,
    "tokenUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBilling_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TokenAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "modelUsed" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "calculatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ttftMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TokenAuditLog_userId_createdAt_idx" ON "TokenAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TokenAuditLog_userId_jobId_idx" ON "TokenAuditLog"("userId", "jobId");

-- AddForeignKey
ALTER TABLE "UserBilling" ADD CONSTRAINT "UserBilling_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenAuditLog" ADD CONSTRAINT "TokenAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
