-- AgentJob: server-side agent run queue with checkpoint persistence
CREATE TABLE "AgentJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" TEXT NOT NULL,
    "provider" JSON,
    "checkpoint" JSON,
    "result" JSON,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "AgentJob_userId_status_updatedAt_idx" ON "AgentJob"("userId", "status", "updatedAt");
