# Production Closure Progress

Last updated: 2026-09-03

## Current state: Phase 7 verified; Goal remains active for Phase 8

- Current branch: `fix/production-closure`.
- Completed phase commits: `8984cd3`, `0b49d9a`, `b1174c3`, `8ff424b`, `b0a50e5`, `7f3f837` (plus baseline/lint checkpoints `c3bbab3` and `4585b1c`).
- The nested `qiushi-skill` repository remains pre-existing dirty state and was not changed.
- Phase 7 is verified below and is ready for its independent commit; Phase 8 remains untouched.

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
- [ ] Phase 8: documentation and release gates

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

## Known failures and unresolved risks

- `npx tsc --noEmit` still fails with 8 pre-existing test typing errors in billing, crypto, node-retry, peer-review-checkpoint, and proxy-gateway tests. These are not caused by Phase 6 or Phase 7 and must be fixed before the final release gate.
- PostgreSQL migration application remains unverified until a real PostgreSQL `DATABASE_URL`/`DIRECT_URL` is supplied; the local `file:./dev.db` URL cannot be used with this schema.
- Lint is green by exit code but still reports 9 warnings (unused variables and hook dependency warnings).
- The “no provider API key in browser” invariant is improved but not fully structural: Models/Setup/legacy gateway still contain browser-side provider-probe functions. They currently receive no runtime key from the store, but a future server-side probe endpoint should replace them.
- Vercel Blob production credentials are unavailable here, so remote object upload/download remains deployment-time verification.
- Existing `file://` Library records are kept for a non-destructive compatibility window; a monitored migration/cleanup policy is still needed.
- Library indexing currently runs inline after upload. Large PDFs or parser outages can increase upload latency; background indexing/retry policy is not implemented.

## Unfinished tasks after Phase 7

- Implement Phase 8: synchronize README, AGENTS.md, `.env.example`, deployment/migration/rollback documentation, and release checklist.
- Resolve the 8 baseline TypeScript diagnostics, reduce or consciously document remaining lint warnings, then rerun all release gates.
- Verify additive Prisma migrations and Blob configuration in a staging-like environment before any production deployment.

## External blockers

- Production Vercel Blob credentials are not available in this workspace. The adapter, failure behavior, and tests are complete; real remote upload/download verification requires `BLOB_READ_WRITE_TOKEN` or Vercel OIDC configuration before deployment.

## Notes

- The pre-existing worktree contains broad uncommitted changes in Agent, Canvas, Library, README, Prisma, and UI code. Commits in this effort must be path-scoped and reviewed against the saved baseline to avoid claiming unrelated work.
