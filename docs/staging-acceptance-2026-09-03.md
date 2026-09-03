# Staging Acceptance Log — 2026-09-03

This log is intentionally sanitized. It contains no database URL, password, session cookie, API key, Blob token, container identifier, or object identifier.

## Scope and safety

- Revision under test: `6191530` on `fix/production-closure`.
- Read the deployment, production-closure progress, and legacy `file://` migration documents before execution.
- No production host or production database was contacted.
- No production deployment was performed.
- No legacy `file://` file or user document was deleted.
- The PostgreSQL instance was an empty, disposable PostgreSQL 16 container without a host filesystem volume. The container was removed automatically after the checks.

## PostgreSQL staging result: PASS

1. Temporary PostgreSQL readiness: passed.
2. `npx prisma validate`: passed.
3. Initial `npx prisma migrate status`: correctly reported all five migrations pending on the empty staging database. Prisma returned its expected pending-migration status.
4. `npx prisma migrate deploy`: passed; all five repository migrations were applied in order.
5. Final `npx prisma migrate status`: passed; schema reported up to date.
6. Read-only post-migration SQL: passed.
7. `AgentJobStatus.cancelled`: present once, after `pending`, `running`, `done`, and `error`.
8. Migration `20260902203000_agent_job_cancelled`: recorded as finished and not rolled back.
9. Existing Agent job counts: zero because this was an empty disposable staging database.
10. Temporary container cleanup: passed; no matching container remained.

This proves that the complete migration chain and the additive `cancelled` enum migration execute successfully on a real PostgreSQL 16 engine. It does not prove compatibility with a clone containing production-shaped historical data or migration history.

## Vercel Blob staging result: BLOCKED / NOT RUN

The current process had no `STAGING_BASE_URL`, `STAGING_EXPECTED_HOST`, staging authentication cookie, Blob token, or Vercel OIDC Blob configuration. No HTTP request or Blob operation was attempted. Upload, byte-identical read, indexed retrieval, exact-document deletion, and object-deletion confirmation remain unverified on real staging infrastructure.

## Application staging flows: BLOCKED / NOT RUN

A deployed staging application URL, authentication context, Blob configuration, and model/provider execution credential were not available. Therefore no claim is made for a live staging Agent SSE request, live cancellation/checkpoint recovery, live conversation/Canvas reload, or live Library failure-state rendering.

Local route/integration evidence was rerun for these behaviors:

- 6 focused test files / 18 tests passed.
- Agent SSE protocol and route events passed.
- Cancellation waits for queued checkpoints and persists the cancelled state.
- Conversation responses and Canvas selection/recovery passed.
- Library loaded/missing/failed outcomes and evidence-status merging passed.
- The expected abort exception emitted by the cancellation failure-path test was diagnostic stderr, not a test failure.

The first focused-test command did not start because zsh interpreted the `[id]` route directory as a glob. Quoting the path fixed the command; the corrected run passed.

## Release decision

Production release condition: **NOT MET**.

The PostgreSQL empty-staging migration gate passed. Release remains blocked on real Vercel Blob staging and live staging application flows. A production-shaped PostgreSQL clone is also recommended before production deployment because this run contained no historical rows or migration history divergence.
