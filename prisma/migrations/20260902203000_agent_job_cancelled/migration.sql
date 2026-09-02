-- Distinguish user/request cancellation from execution failures.
ALTER TYPE "AgentJobStatus" ADD VALUE IF NOT EXISTS 'cancelled';
