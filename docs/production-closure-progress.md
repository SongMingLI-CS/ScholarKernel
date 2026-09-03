# Production Closure Progress

Last updated: 2026-09-03

## Current state: Phases 1–8 locally verified; hosted Neon staging migration passed

- Current branch: `fix/production-closure`.
- Completed phase commits: `8984cd3`, `0b49d9a`, `b1174c3`, `8ff424b`, `b0a50e5`, `7f3f837`, `caf5529`, and `f734994` (plus baseline/lint checkpoints `c3bbab3` and `4585b1c`).
- The nested `qiushi-skill` repository remains pre-existing dirty state and was not changed.
- Phases 1–8 are independently committed. Final deployment-acceptance tooling and documentation are included in their own independent acceptance commit. Both disposable PostgreSQL 16 and the user-identified hosted Neon staging target are schema-up-to-date; Preview deployment remains blocked on Vercel setup, private Blob, and live application validation.

## Baseline

- [x] Inspected git state before changes.
- [x] Preserved pre-existing dirty worktree changes.
- [x] Created branch `fix/production-closure`.
- [x] Captured the pre-existing tracked diff and status under `/tmp` for local comparison only.
- [x] Baseline test, lint, and typecheck results recorded.

## Phase status

- [x] Phase 1: server Agent SSE mainline
- [x] Phase 2: frontend SSE state restoration
- [x] Phase 3: object storage Library
- [x] Phase 4: Canvas recovery
- [x] Phase 5: chunked retrieval RAG
- [x] Phase 6: unified execution semantics
- [x] Phase 7: transparent source/degradation status
- [x] Phase 8: documentation and release gates

## Test evidence

### Baseline before production-closure implementation

- `npm test`: passed, 53 files / 283 tests.
- `npm run lint`: failed with 3 pre-existing `react-hooks/set-state-in-effect` errors in `my-library-panel.tsx`, `ThinkingAgentNode.tsx`, and `public-share-page.tsx`, plus 10 warnings.
- `npx tsc --noEmit`: failed with 7 pre-existing test typing errors in billing, crypto, node-retry, peer-review-checkpoint, and proxy-gateway tests.
- Production build has not yet been run; it is a final release gate.

### Phase 1

- Added versioned Agent SSE events for `hello`, `plan`, `node`, `log`, `token`, `canvas`, `source`, `usage`, `intervention`, `error`, and `done`.
- Added authenticated `/api/agent/stream`; it creates/updates Agent jobs, resolves encrypted credentials on the server, streams executor hooks, records usage, persists completion/failure, and uses the request abort signal.
- The stream route rejects any browser-supplied `runtimeKeys` field.
- Relevant tests: 6 protocol/route tests passed.
- Full suite after implementation: 56 files / 293 tests passed.
- Full lint after baseline cleanup: passed with warnings only.

### Phase 2

- `useChatSend` now calls `/api/agent/stream`; it no longer imports or constructs `AgentExecutor` in the default chat path.
- The incremental stream client parses arbitrarily split SSE frames, maps HTTP auth/rate-limit failures, and requires a terminal event.
- The frontend event adapter restores plan, nodes, logs, streamed tokens, Canvas, sources, token usage, intervention state, and stream errors.
- Stream request serialization is allowlisted and drops legacy `runtimeKeys` even from an unsafe caller.
- Settings GET/PATCH responses expose only per-provider configured booleans; decrypted keys are never returned to Zustand or UI.
- Keys entered for configuration are uploaded to encrypted server storage and cleared from component state after submission.
- Relevant tests: 12 stream/settings/event-adapter tests passed.

### Phase 3

- Added a provider-neutral `LibraryObjectStorage` interface with a private Vercel Blob adapter.
- New uploads are stored as `object://` references; no new upload writes to the server filesystem.
- File download, Agent document loading, and deletion resolve object references through the adapter.
- Existing `file://` records retain read/delete compatibility for a non-destructive migration window.
- Upload failure removes the temporary `Document` row; missing Blob configuration returns HTTP 503 with an actionable message.
- Relevant tests: 18 storage, upload-route, Library, and academic-RAG tests passed.

### Phase 4

- Conversation detail responses now include owned Canvas documents ordered by most recent update.
- Conversation switching selects the latest Canvas document, restores it into Zustand, and opens the Canvas workspace.
- Empty conversations continue with a closed Canvas.
- Relevant tests: 13 conversation, Canvas recovery, create, and update tests passed.

### Phase 5

- Added additive `DocumentChunk` storage plus document index status fields; the migration preserves existing `Document` rows.
- Uploads are parsed into section/page-aware, bounded chunks and indexed transactionally after object storage succeeds.
- Existing documents without chunks are indexed lazily on first Agent retrieval.
- Agent Library context is now query-ranked and capped at 10 chunks / 12,000 characters instead of injecting complete documents.
- Retrieved context retains document title, section, page, and chunk identity for later evidence tracing.
- Relevant tests: 10 focused retrieval, indexing, lazy migration, and upload tests passed.
- Full suite after implementation: 63 files / 309 tests passed; full lint passed with warnings only.

### Phase 6

- Node retry was migrated from browser-side dynamic `AgentExecutor` loading to the shared `/api/agent/stream` SSE path; server-side resume snapshots can be derived from supplied workflow nodes when no persisted snapshots exist.
- Legacy `/api/agent/run` and `/api/agent/jobs` now reject browser-supplied `runtimeKeys` and load encrypted credentials on the server.
- Added a shared Agent error classifier and a distinct `cancelled` AgentJob status/migration; stream checkpoint writes are queued before terminal completion/failure.
- Added focused tests for cancellation classification, cancelled job persistence, legacy credential rejection, and stream checkpoint ordering.
- Removed the `NEXT_PUBLIC_TAVILY_API_KEY` / `NEXT_PUBLIC_SERPER_API_KEY` search-key fallbacks so public environment variables cannot become provider credentials.
- Focused Phase 6 verification: 5 test files / 27 tests passed before the final route-queue test; final full verification is 64 test files / 315 tests passed.
- `npm run lint`: passed with 0 errors and 9 pre-existing warnings.
- `npm run build`: passed; Next.js reported only the existing middleware deprecation and NFT tracing warning.
- `npx tsc --noEmit`: no Phase 6 errors; 7 pre-existing test typing errors remain (billing usage shape, readonly `NODE_ENV` assignments, node-retry JSON typing, peer-review callback return type).
- `npx prisma validate`: passed. `npx prisma migrate status`: accurately blocked because the local `.env` resolves to `file:./dev.db`, which is invalid for this PostgreSQL datasource; no real PostgreSQL credentials were available, so migration application is unverified.
- Checkpoint ordering is covered for both `/api/agent/stream` and legacy `/api/agent/jobs`; queued writes are awaited before complete/fail/cancel, and cancellation preserves the latest node checkpoint while setting `phase: cancelled`.
- Browser audit: the default chat and node-retry paths send only the allowlisted SSE payload; all Agent API routes reject `runtimeKeys`; settings responses expose booleans only; persisted Zustand state drops key material; search tools no longer read `NEXT_PUBLIC_*` keys. Models/Setup and `ai-gateway` still contain legacy provider-probe code paths, but current store hydration/setters keep runtime key material null; a server-side probe replacement remains a follow-up security hardening item.

### Phase 7

- Added a shared evidence-status model for Library documents, academic search, and file reads with explicit `loaded`, `missing`, `failed`, and `degraded` states.
- Server Agent execution emits Library resolution/indexing outcomes and search/file outcomes through a new SSE `evidence` event. Error details are length-bounded and secret-pattern-redacted at the server stream boundary.
- Chat send and node retry merge evidence events into the active assistant message; message metadata persists and restores the statuses across conversation reloads.
- Assistant responses render a visible evidence-status panel. Any non-loaded source is highlighted as degraded, so incomplete evidence is disclosed in the final response area instead of only in node logs or the console.
- Focused Phase 7 verification: 6 test files / 16 tests passed, covering protocol parsing, event dispatch, metadata round trips, Library outcomes, status merging, and stream redaction.
- Full suite after implementation: 65 test files / 319 tests passed.
- `npm run lint`: passed with 0 errors and the same 9 pre-existing warnings.
- `npx tsc --noEmit`: no Phase 7 errors; the 8 pre-existing test diagnostics remain.

### Phase 8

- Updated README, AGENTS.md, and `.env.example` to match PostgreSQL/Neon, private Vercel Blob storage, authenticated server Agent SSE, Canvas recovery, chunked Library RAG, evidence status, and server-only credentials.
- Added `docs/deployment.md` with release gates, PostgreSQL migration procedure, staging smoke tests, object-storage verification, legacy `file://` compatibility, and rollback limitations for PostgreSQL enum values.
- Removed obsolete SQLite paths and persistent SQLite volume configuration from Docker; the container now requires externally supplied PostgreSQL environment variables and runs `prisma migrate deploy` before start.
- Added `npm run typecheck` and resolved all 8 pre-existing test type diagnostics. Removed all 9 pre-existing lint warnings without changing runtime architecture.
- `npm run lint`: passed with 0 errors and 0 warnings.
- `npm run typecheck`: passed.
- `npm test`: passed, 65 test files / 319 tests.
- `npm run build`: passed. Next.js reported only the existing middleware convention deprecation and NFT tracing warning for `src/app/api/source/route.ts`.
- `npx prisma validate`: passed.
- `npx prisma migrate status`: blocked with Prisma P1013 because the local `.env` URL is `file:./dev.db`, not PostgreSQL. No migration application or remote Blob operation is claimed as verified.

## Final deployment acceptance preparation

### Code complete

- Added a guarded PostgreSQL staging verifier. Its default mode is plan-only; `--status` and `--apply` require a PostgreSQL `STAGING_DATABASE_URL`, an independently repeated hostname, and the exact staging confirmation string. It never invokes `prisma db push`.
- Added a read-only SQL verification script for the `cancelled` enum, Prisma migration record, and Agent job status counts.
- Added a guarded Vercel Blob smoke script covering upload, byte-identical read, indexed marker retrieval, deletion of only the newly created document, and post-delete 404 verification. Its default mode performs no network request.
- Added a client-bundle credential scanner that reports only finding categories and asset filenames, never matched values.
- Added a copy-and-verify-only migration procedure for legacy `file://` documents. It never deletes, moves, truncates, or overwrites original files; cleanup requires a separate approval and audit trail.
- Corrected stale Models, Setup, sidebar, and chat copy so it describes authenticated server SSE, encrypted server-side credential storage, and status-only browser responses.
- `.env.example` documents all 39 application, provider, storage, parser, reranking, staging-verification, and test variables expected by the current code and acceptance tools (39/39, none missing).

### Local validation complete

- `npm run lint`: passed, 0 errors and 0 warnings.
- `npm run typecheck`: passed.
- `npm test`: passed, 66 test files / 326 tests.
- Synthetic-sentinel `npm run build`: passed with Next.js 16.2.4. The only output warnings were the known middleware convention deprecation and NFT trace warning involving `next.config.ts` and `src/app/api/source/route.ts`.
- `npm run audit:client-bundle`: passed after the final build, with 0 credential-like literals across 82 browser asset files. Fake server-secret sentinels overrode the audited server credential names for the build; no real secret value was manually inspected or echoed.
- Acceptance-script tests verify plan-only defaults, refusal without explicit staging targets, additive/idempotent enum SQL, and non-disclosure of a detected synthetic credential.
- `docs/deployment.md` was checked against the actual package scripts and `/api/documents`, `/api/documents/:id/file`, and `/api/documents/context` behavior.

### Staging validation status

- PostgreSQL migration execution is now verified on the disposable PostgreSQL 16 instance documented below. A production-shaped hosted clone still requires `STAGING_DATABASE_URL`, `STAGING_EXPECTED_DB_HOST`, and `STAGING_CONFIRMATION=scholarkernel-staging`; the deployed application also requires valid `DATABASE_URL` and `DIRECT_URL`.
- Vercel Blob remains unverified externally. The staging application needs `BLOB_READ_WRITE_TOKEN`, or both `VERCEL_OIDC_TOKEN` and `BLOB_STORE_ID`; the smoke runner needs `STAGING_BASE_URL`, `STAGING_EXPECTED_HOST`, and the staging confirmation, plus `STAGING_AUTH_COOKIE` when authentication requires it.
- The `cancelled` migration is statically compatible and successfully executed on disposable PostgreSQL 16: it uses only `ADD VALUE IF NOT EXISTS`, preserves the existing labels, and produced the expected enum order. Historical production-shaped rows remain untested.

### Production deployment not completed

- No production deployment, production database operation, remote Blob operation, old `file://` deletion, or user-data deletion was performed. The later staging run below used only an empty disposable PostgreSQL container.
- The revision is code- and local-gate-ready, but it is not production-release-ready until the remaining real Blob and authenticated application staging workflows pass and their results are reviewed.

## Staging acceptance run — 2026-09-03

The complete sanitized record is in [`staging-acceptance-2026-09-03.md`](staging-acceptance-2026-09-03.md).

### PostgreSQL staging: passed

- Used an empty, disposable PostgreSQL 16 container with no host filesystem volume. A generated credential existed only inside the validation process and was never printed, saved, or committed.
- `npx prisma validate` passed.
- Initial `npx prisma migrate status` correctly reported all five migrations pending.
- `npx prisma migrate deploy` applied all five migrations successfully; the final status reported the schema up to date.
- Read-only SQL confirmed `cancelled` appears once as the fifth `AgentJobStatus` label and `20260902203000_agent_job_cancelled` is finished and not rolled back.
- The temporary container was removed after verification. No production database or persistent user data was touched.
- Limitation: this was an empty staging database. Production-shaped historical rows and divergent migration history were not exercised.

### Blob staging: blocked, not run

- The current process did not have a staging application URL/authentication context or Vercel Blob credentials. No remote request was attempted and no Blob result is claimed.
- Real PDF upload, byte-identical read, indexed query, exact-document deletion, and private-object deletion confirmation remain required.

### Application staging flows: blocked, not run

- A live Agent SSE request, live cancellation/checkpoint recovery, conversation/Canvas recovery, and Library failure-state presentation require an authenticated staging deployment plus model/Blob configuration, which were unavailable.
- Local evidence was rerun: 6 focused files / 18 tests passed for Agent SSE events, checkpoint-before-cancel ordering, Canvas recovery, and loaded/missing/failed evidence states. These tests are not represented as live staging verification.

### Release condition

- **Not met.** PostgreSQL empty-staging migration passed, but real Vercel Blob staging and authenticated live application staging flows remain release blockers. A production-shaped PostgreSQL clone check is also recommended before production deployment.

## Hosted Neon and Vercel Preview follow-up — 2026-09-03

### Hosted Neon PostgreSQL: passed

- The active pooler/direct/staging URL relationship passed a value-redacted fingerprint check, and the old endpoint was absent from `.env.staging.local`.
- `prisma validate`, guarded `prisma migrate deploy`, and final `prisma migrate status` passed; the final schema is up to date.
- All five expected migration records are finished and not rolled back. The `cancelled` enum and its expected ordering were confirmed with read-only SQL.
- An earlier status check showed five pending migrations, but this follow-up began with all five already applied. The deploy command was therefore an idempotent no-op; the external process that applied them between checks is unknown.

### Vercel Preview: blocked, not deployed

- Vercel CLI is absent, `.vercel` project linkage is absent, and the current branch has no Git upstream. Per the deployment guard, no Preview or production deployment was attempted.
- Browser action is required to sign in to Vercel, authorize/import the GitHub repository, configure Preview-scoped variables, and create/connect a private Blob store.
- No Preview URL exists. Blob lifecycle and all live Agent/Canvas/Library checks remain not run.
- The current code uses `DEEPSEEK_API_KEY`, the fixed DeepSeek upstream `https://api.deepseek.com`, and default model `deepseek-chat`; it does not read `DEEPSEEK_BASE_URL`.

### Web usability decision

- **Not yet verified for normal web use.** Database migration is ready, but a Preview deployment with authentication, private Blob, model credentials, and full live smoke verification is still required.

## Known failures and unresolved risks

- The full migration chain now passes on an empty disposable PostgreSQL 16 instance. Compatibility with production-shaped historical rows or a database previously synchronized outside Prisma migration history remains unverified.
- The “no provider API key in browser” invariant is improved but not fully structural: Models/Setup/legacy gateway still contain browser-side provider-probe functions. They currently receive no runtime key from the store, but a future server-side probe endpoint should replace them.
- Vercel Blob credentials were not used here, so remote upload/read/index/delete remains a staging release gate.
- Existing `file://` Library records are kept for a non-destructive compatibility window; a monitored migration/cleanup policy is still needed.
- Library indexing currently runs inline after upload. Large PDFs or parser outages can increase upload latency; background indexing/retry policy is not implemented.

## Unfinished external verification after PostgreSQL staging acceptance

- Investigate or document the external process that applied the five hosted Neon migrations between the two read-only checks; preserve the final verified migration history.
- Repeat PostgreSQL verification on a staging clone with production-shaped historical data before production deployment if the current hosted staging database remains empty.
- Supply staging Blob credentials and verify private upload/read/delete plus RAG indexing end to end.
- Replace Models/Setup legacy browser provider probes with an authenticated server probe in a future hardening phase; this was intentionally not added to the Phase 8 documentation/release-gate scope.

## External blockers

- Staging Vercel Blob credentials were not injected into this process. The adapter, failure behavior, and tests are complete; real remote upload/download verification requires `BLOB_READ_WRITE_TOKEN` or Vercel OIDC configuration on the staging application before deployment.
- Hosted Neon staging is up to date. Production-shaped historical data compatibility remains unverified if this staging database has no representative rows.

## Notes

- The only preserved unrelated worktree item is the pre-existing dirty nested `qiushi-skill` repository. It was not modified or staged by this effort.
