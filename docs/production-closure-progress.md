# Production Closure Progress

Last updated: 2026-09-02

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
- [ ] Phase 6: unified execution semantics
- [ ] Phase 7: transparent source/degradation status
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

## External blockers

- Production Vercel Blob credentials are not available in this workspace. The adapter, failure behavior, and tests are complete; real remote upload/download verification requires `BLOB_READ_WRITE_TOKEN` or Vercel OIDC configuration before deployment.

## Notes

- The pre-existing worktree contains broad uncommitted changes in Agent, Canvas, Library, README, Prisma, and UI code. Commits in this effort must be path-scoped and reviewed against the saved baseline to avoid claiming unrelated work.
