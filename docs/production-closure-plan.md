# Production Closure Plan

## Objective

Close the production gaps in the current ScholarKernel Web implementation while preserving existing work, keeping migrations backward compatible, and preventing provider API keys from reaching the browser.

## Baseline constraints

- Work branch: `fix/production-closure`
- The worktree was already heavily modified before this effort. Pre-existing changes are preserved and must not be reset or overwritten.
- No production deployment, destructive data migration, main-branch merge, or push is part of this plan.
- Each phase must end in a runnable vertical slice, relevant tests, progress documentation, and an atomic commit.

## Phase 1 — Server Agent streaming mainline

### Acceptance criteria

- Chat sends requests to an authenticated server route instead of loading `AgentExecutor` in the browser.
- The server emits a versioned SSE protocol covering `plan`, `node`, `log`, `token`, `canvas`, `source`, `usage`, `error`, and terminal completion.
- Provider and search credentials are resolved only on the server and are never accepted from or returned to browser code.
- Cancellation aborts the server execution through the request signal.
- Existing direct-chat, workflow, peer-review, search, and Canvas behavior remain observable through SSE.

### Test targets

- `src/lib/__tests__/agent-stream-protocol.test.ts`
- `src/app/api/agent/stream/__tests__/route.test.ts`
- `src/lib/__tests__/agent-stream-client.test.ts`
- existing Agent executor/server tests

## Phase 2 — Frontend SSE state restoration

### Acceptance criteria

- Zustand receives every protocol event and restores workflow topology, node logs, streamed answer text, sources, Canvas, usage, errors, and completion state.
- Optimistic message rollback, stop generation, retry, and persistence keep working.
- No runtime provider keys are serialized into the stream request.

### Test targets

- `src/store/__tests__/agent-stream-events.test.ts`
- chat send and optimistic UI tests

## Phase 3 — Object storage Library

### Acceptance criteria

- `Document.fileUrl` identifies an object-storage object rather than a server-local `file://` path for all new uploads.
- A storage interface supports upload, read, and delete with a production object-store adapter and a test adapter.
- Existing local-file records remain readable during migration.
- Missing credentials produce an actionable configuration error without blocking unrelated development or tests.

### Test targets

- `src/lib/__tests__/library-object-storage.test.ts`
- document route tests

## Phase 4 — Canvas recovery

### Acceptance criteria

- Conversation fetch includes Canvas documents.
- Refreshing or reopening a conversation restores the latest Canvas document.
- Canvas changes remain debounced and ownership-protected.

### Test targets

- conversation route tests
- `src/store/__tests__/canvas-recovery.test.ts`

## Phase 5 — Chunked retrieval RAG

### Acceptance criteria

- Parsed documents are stored as bounded chunks with page/source metadata.
- Retrieval ranks chunks against the current query and injects only a token-bounded selection.
- Full-document injection is no longer the default.
- Existing documents can be lazily indexed without destructive migration.

### Test targets

- `src/lib/__tests__/library-rag.test.ts`
- Prisma/API integration contracts

## Phase 6 — Unified execution semantics

### Acceptance criteria

- Server execution owns job lifecycle, checkpoint persistence, token accounting, cancellation, and normalized errors.
- Direct chat and planned workflows emit the same terminal and usage semantics.
- Node retry uses the same streaming route and event model.

### Test targets

- Agent jobs, server run, node retry, billing, abort, and error-model tests

## Phase 7 — Transparent source status

### Acceptance criteria

- The UI identifies successfully loaded, failed, missing, and degraded Library/search sources.
- Final responses visibly disclose degraded evidence rather than relying on console logs.

### Test targets

- protocol and store event tests
- source-status presentation helpers

## Phase 8 — Documentation and release gates

### Acceptance criteria

- README, AGENTS.md, `.env.example`, and deployment instructions match the actual PostgreSQL, object storage, server-Agent, SSE, Canvas, and RAG implementation.
- `npm run lint`, TypeScript typecheck, full tests, and `npm run build` pass.
- Migration and rollback steps are documented.

## Rollback strategy

- Every phase is an independent commit and can be reverted in reverse order.
- Schema changes are additive until all runtime code has migrated.
- Legacy local Library records remain readable until an explicit later cleanup migration.
- Object storage deletion is never performed as part of database migration.
