CREATE TABLE "AgentIntervention" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "instruction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentIntervention_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentIntervention_jobId_nodeId_key" ON "AgentIntervention"("jobId", "nodeId");
ALTER TABLE "AgentIntervention" ADD CONSTRAINT "AgentIntervention_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AgentJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
