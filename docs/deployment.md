# Production Deployment

ScholarKernel runs as a Next.js Node.js application backed by PostgreSQL. Library uploads require private object storage; Agent execution streams over authenticated SSE and resolves model/search credentials only on the server.

## Required services

- Node.js 20 or a compatible Vercel runtime.
- PostgreSQL, with a pooled `DATABASE_URL` for the application and a direct `DIRECT_URL` for Prisma CLI migrations.
- PostgreSQL must allow the `vector` extension for hybrid Library retrieval. The migration creates it with `CREATE EXTENSION IF NOT EXISTS vector`.
- Vercel Blob private storage through `BLOB_READ_WRITE_TOKEN`, or both `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID`.
- A high-entropy `ENCRYPTION_SECRET` and `AUTH_SECRET`.
- At least one server-side model credential, or provider keys saved through the authenticated Settings API.

Upstash Redis is optional but recommended for distributed rate limiting. Without both Upstash variables, the current limiter intentionally fails open. An external layout parser is optional; local PDF/DOCX parsing remains available.

See `.env.example` for every supported variable. Never expose provider, search, encryption, auth, Blob, parser, or proxy credentials through `NEXT_PUBLIC_*` variables.

## Pre-deployment gates

Run against the exact revision to be released:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The build performs `prisma generate`. It does not prove that a target database accepts pending migrations or that remote Blob credentials work.

## Database migration

1. Take a PostgreSQL backup or provider snapshot.
2. Point `DIRECT_URL` at a disposable staging clone that reflects production.
3. Inspect migration state without changing it:

   ```bash
   npx prisma validate
   npx prisma migrate status
   ```

4. Review the SQL under `prisma/migrations/`, then apply it to staging:

   ```bash
   npm run db:migrate
   ```

5. Start the application against staging and verify sign-in, one Agent SSE run, cancellation/checkpoint recovery, a Library upload/read/delete cycle, lazy indexing of one legacy document, conversation/Canvas reload, and evidence-status disclosure.
6. Repeat `npm run db:migrate` against production only after the staging checks pass.

Do not use `prisma db push` for production. Do not use `prisma migrate resolve` unless the actual database history has been independently reconciled. This repository may encounter databases previously synchronized with `db push`; validate their tables and migration history on a clone before deployment.

The `20260902203000_agent_job_cancelled` migration adds the PostgreSQL enum value `cancelled`. It is additive. See `production-closure-progress.md` for the latest staging evidence; every release must still run `prisma migrate status` and `prisma migrate deploy` against its confirmed target before application smoke tests.

The `20260908173000_hybrid_rag_dag` migration is also additive. It enables pgvector, adds 1536-dimensional chunk embeddings plus parser/chunker/hash metadata, creates a partial HNSW cosine index, and adds DAG fingerprint, attempt, output-snapshot, heartbeat, and lease fields. Confirm on the staging clone that the database role can create the extension before deployment. If the provider manages extensions separately, enable `vector` through its control plane first, then rerun `prisma migrate deploy`; do not edit the recorded migration after partial application.

### Library embedding and incremental backfill

Vector retrieval is opt-in and never borrows a chat-model key. Configure `EMBEDDING_API_KEY`, and optionally `EMBEDDING_BASE_URL` and `EMBEDDING_MODEL`. Without it, indexing and search remain operational in explicit BM25-only degraded mode.

New uploads return after private object storage and database persistence, then use the existing `AgentJob` lifecycle through Next.js `after()`. The route declares a 300-second maximum duration. On a hosting platform that does not support post-response work, run the Node.js deployment target or verify the platform's equivalent lifecycle before enabling uploads; no external queue or worker is assumed.

For an existing document, call authenticated `PATCH /api/documents` with `{ "id": "<document-id>", "reindex": true }`. The response contains `indexJobId`; poll `GET /api/agent/jobs/<indexJobId>`. The job compares file hash, parser version, chunk version, and embedding model version, so unchanged documents are skipped while changed files or models rebuild. Backfill in bounded batches and wait for each batch to finish before starting the next one to stay within database and embedding-provider limits.

For global historical backfill, explicitly set `LIBRARY_MAINTENANCE_ADMIN_USER_IDS` to a comma-separated allowlist of authenticated user IDs. The endpoint fails closed when this variable is missing. An allowlisted operator can preview with `GET /api/admin/documents/reindex?limit=10&cursor=<document-id>` and schedule with `POST /api/admin/documents/reindex` using `{ "limit": 10, "cursor": "<document-id>" }`. Each response includes `scanned`, `nextCursor`, and `hasMore`; pass the returned cursor to the next request. The database scan is capped at ten times the requested batch (at most 500 rows), each batch schedules at most 50 documents, and jobs run as each document's actual owner. Wait for scheduled jobs to settle before requesting another batch. The existing `/api/documents/reindex` endpoint remains user-scoped.

Set `AGENT_DAG_CONCURRENCY` to the maximum number of ready nodes executed inside one application process (default 3, minimum 1). This is not a distributed queue. A startup recovery pass marks expired running leases as an explicit error so they can be resumed instead of remaining RUNNING forever.

### Repeatable staging verification

The repository includes a guarded verifier. With no arguments it only prints the plan and never connects:

```bash
npm run verify:staging:migration
```

For a confirmed staging clone, provide a direct PostgreSQL URL and repeat its hostname separately. The explicit confirmation prevents accidental execution when variables are incomplete. The script never invokes `prisma db push`.

```bash
export STAGING_DATABASE_URL='postgresql://...'
export STAGING_EXPECTED_DB_HOST='staging-db-host.example'
export STAGING_CONFIRMATION='scholarkernel-staging'

npm run verify:staging:migration -- --status
# Review backup, target identity, migration SQL, and status output before continuing.
npm run verify:staging:migration -- --apply
psql "$STAGING_DATABASE_URL" -f scripts/sql/verify-cancelled-migration.sql
npm run verify:staging:rag-dag -- --run
```

Both `--status` and `--apply` run `prisma validate` and `prisma migrate status`; `--apply` additionally runs the idempotent `prisma migrate deploy` followed by another status check. Capture pre/post counts for existing `pending`, `running`, `done`, and `error` jobs. The read-only SQL verifies the migration record, enum label/order, and post-migration job counts.

The enum SQL is compatible with existing values because it only runs `ALTER TYPE "AgentJobStatus" ADD VALUE IF NOT EXISTS 'cancelled'`. It does not rewrite rows, tables, or existing enum labels, and a repeat execution is a no-op. Do not attempt to remove the value during rollback; deploy the earlier application first and leave the additive label in place.

`verify:staging:rag-dag` is a separate, read-only post-migration gate. It asserts the `vector` extension, the 1536-dimensional vector column, the partial HNSW cosine index, both hybrid/content-aware migration records, and compatibility reads over legacy nullable Document, chunk, checkpoint, and node fields. With no `--run` argument it prints a plan and makes no connection.

## Object storage verification

Unit tests use an injected storage adapter and do not contact Vercel Blob. Before release, upload a small PDF in staging, retrieve it through `/api/documents/:id/file`, run a query that uses its indexed chunks, then delete it and verify the private object is removed. Missing Blob configuration returns an intentional 503 for uploads and does not block unrelated application routes.

Existing `file://` Library records remain readable during the compatibility window. Database migrations never delete those files or private Blob objects. Plan a separate, monitored copy-and-verify job before retiring local records.

The guarded HTTP smoke script defaults to a no-network plan. `--run` creates one uniquely named Markdown document, checks its `object://` reference, reads and compares its bytes, retrieves its indexed marker, deletes that exact document, and confirms it is no longer available. Cleanup is attempted if an intermediate assertion fails.

```bash
npm run smoke:staging:blob

export STAGING_BASE_URL='https://staging.example.com'
export STAGING_EXPECTED_HOST='staging.example.com'
export STAGING_CONFIRMATION='scholarkernel-staging'
# Required only when the staging application enforces authentication:
export STAGING_AUTH_COOKIE='authjs.session-token=...'
# Required when Vercel Deployment Protection is enabled:
export STAGING_PROTECTION_BYPASS='...'

npm run smoke:staging:blob -- --run
```

The staging application—not this client script—must already have `BLOB_READ_WRITE_TOKEN`, or the Vercel OIDC pair `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID`. The script never prints those values or the auth cookie.

For the complete release smoke, configure an Agent provider and a protected staging-only restart webhook. The webhook must return success only after accepting a restart of the selected staging deployment; it must not target production. The runner independently verifies its HTTPS hostname and sends its token only in the Authorization header.

```bash
npm run smoke:staging:release

export STAGING_AGENT_PROVIDER_ID='openai'
export STAGING_AGENT_MODEL='gpt-4.1-mini'
export STAGING_RESTART_WEBHOOK_URL='https://deploy.example.com/hooks/restart-staging'
export STAGING_EXPECTED_RESTART_HOST='deploy.example.com'
export STAGING_RESTART_WEBHOOK_TOKEN='...'

npm run smoke:staging:release -- --run
```

This generates a PDF of at least 1.5 MB; checks bounded upload response time and byte-identical download; waits for asynchronous indexing; validates marker retrieval and unchanged-file reindex; exercises SSE disconnect, completed-result refresh/replay, a real process restart with database recovery, and explicit cancellation; then deletes the exact test document and confirms both its API file and Library row are gone. Cleanup is attempted after intermediate failures. A dry plan is always safe and performs no network request.

The legacy migration procedure is documented separately in [`library-file-migration.md`](library-file-migration.md). It permits copying, byte/digest verification, indexing verification, and a conditional database-reference switch. Original files are never deleted by that procedure.

## Browser credential audit

After every production build, scan only the browser assets:

```bash
npm run audit:client-bundle
```

The audit detects credential-shaped literals, private-key material, credentialed PostgreSQL URLs, and synthetic build sentinels. Findings report only category and asset filename; matched values are never printed. For stronger evidence, build with known fake sentinel credentials supplied through the process environment, then rerun the audit. This tests whether server-only variables are inlined without reading real secrets.

## Start and health check

For a Node.js host:

```bash
npm run db:migrate
npm start
```

For Docker, provide the same production variables in `.env`; the image does not bundle a database. The container runs `prisma migrate deploy` before `next start`.

After start, check `/api/health`, authenticate, and perform the staging smoke tests listed above. Confirm that browser requests and persisted client state contain no API keys.

## Rollback

1. Stop new writes or put the service in maintenance mode.
2. Revert the application to the previous phase/release commit and redeploy it.
3. Restore the pre-migration database snapshot only when the reverted application is incompatible with the additive schema. Do not hand-edit Prisma migration history.
4. Leave additive columns/tables in place when the previous application tolerates them.

For the hybrid RAG/DAG phase, first deploy the previous application revision and leave the new nullable/defaulted columns, indexes, and `vector` extension in place. They are ignored by the previous code. Dropping the HNSW index or extension is not required for application rollback and should be handled only by a separate reviewed migration after confirming that no embeddings remain in use. Existing chunk text and document objects are not deleted by this migration.

PostgreSQL enum values cannot be removed safely with a simple reverse migration. For `cancelled`, revert the application first and leave the unused enum value in place; removing it requires a separately reviewed enum-rebuild migration. Object deletion is never part of database rollback.
