\set ON_ERROR_STOP on

-- Read-only post-migration checks. Run only against a confirmed staging clone.
SELECT current_database() AS database_name, current_schema() AS schema_name;

SELECT EXISTS (
  SELECT 1
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'AgentJobStatus' AND e.enumlabel = 'cancelled'
) AS cancelled_enum_present;

SELECT e.enumlabel, e.enumsortorder
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'AgentJobStatus'
ORDER BY e.enumsortorder;

SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at
FROM "_prisma_migrations"
WHERE migration_name = '20260902203000_agent_job_cancelled';

SELECT status::text AS status, COUNT(*) AS row_count
FROM "AgentJob"
GROUP BY status
ORDER BY status;
