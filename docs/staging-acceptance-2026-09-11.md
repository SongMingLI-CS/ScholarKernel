# Staging acceptance — 2026-09-11

This is a sanitized record of the hybrid Library RAG and durable Agent acceptance run. No credentials, document正文, or provider responses are included.

## Release candidate

- Branch: `fix/production-closure`
- Final tested application revision: `84b8b63`
- Vercel environment: protected Preview at `scholar-kernel-staging-restart.vercel.app`
- Database: explicitly confirmed Neon staging clone
- Local gates: 87 Vitest files / 432 tests, production build, ESLint, TypeScript, Prisma validation, and client-bundle credential audit

## Database migration and compatibility

- The guarded preflight found only `20260908173000_hybrid_rag_dag` and `20260908203000_content_aware_chunks` pending.
- `prisma migrate deploy` applied both; the guarded post-check reported 9/9 migrations current.
- Neon exposed pgvector 0.8.6, accepted `vector(1536)`, and created the partial cosine HNSW index `DocumentChunk_embedding_hnsw_idx`.
- Compatibility reads succeeded over the rows present before migration: 1 Document, 217 DocumentChunks, 3 legacy workflow checkpoints without `dependsOn`, and 4 legacy AgentNodes.

## Large PDF and object lifecycle

The final smoke generated a valid 48-page PDF with Flate-compressed page content and a total size of 1,517,355 bytes.

- Upload returned `201` with `pending` index metadata in 4,709 ms.
- The private object downloaded byte-for-byte identically.
- The post-response index Job reached `done`; marker evidence was retrievable.
- Reindexing unchanged bytes completed as `Library index already current` without duplicate parse/embed work.
- Deleting the document removed both the database record and private object; the file endpoint returned `404` and the Library list no longer contained the id.
- All smoke-tagged documents from earlier failed attempts were removed; the final staging count was zero.

The run exposed and fixed three production defects before passing: a PDF operator-loop that could run forever, binary image/attachment streams being tokenized as page text, and a `pending` status check that made unchanged reindex skipping unreachable. FlateDecode content is covered by a regression test.

## Agent lifecycle

- Browser/SSE disconnect left the Job running in Neon rather than cancelling it.
- Reconnect completed the same Job id; a second connection replayed the persisted `done` result, covering browser refresh.
- A cancellation request during a multi-node run left both nodes and the Job in the stable `cancelled` terminal state.
- The live run exposed and fixed a race where a late completion could previously overwrite cancellation.

For the process-death case, a worker claimed a real Neon Job and refreshed its heartbeat every two seconds with a ten-second lease. The worker was then terminated with SIGINT. Neon showed the last heartbeat stop and `leaseExpiresAt < now()`. A different Preview process atomically reclaimed the same Job id after expiry and completed it as `done`. A separate Vercel deployment-removal attempt was not counted because Vercel allows an already-running Lambda invocation to drain.

## RAG quality baseline

The repeatable 130-question fixture covers exact terminology, synonyms, Chinese-to-English retrieval, cross-paragraph questions, conflicting documents, citation metadata, and no-answer cases.

- Recall@5: 0.975
- Recall@10: 0.975
- MRR: 0.975
- Retrieval evidence coverage: 0.975
- Citation-bound answer evidence coverage: 0.975
- Incorrect top-1 citation rate: 0.025
- No-answer citation rate: 0
- Citation metadata hit rate: 1.0
- Human-labelled top-1 relevance: 0.975

The answer-coverage number is a deterministic citation-selection measure over at most five retrieved evidence units; it is not a claim about open-ended LLM prose quality.

## HNSW measurement

A connection-scoped temporary table ensured the benchmark left no persistent rows or indexes. It used 3,000 vectors × 1,536 dimensions and ten exact-versus-ANN top-10 queries. `EXPLAIN (FORMAT JSON)` separately confirmed an `Index Scan` on the HNSW index.

- `m=8`, `ef_construction=64`, `ef_search=40`: Recall@10 1.0; build 911 ms; mean ANN round trip 918.32 ms.
- `m=16`, `ef_construction=64`, `ef_search=40`: Recall@10 1.0; build 1,020 ms; mean ANN round trip 730.89 ms.
- `m=16`, `ef_construction=100`, `ef_search=80`: Recall@10 1.0; build 1,204 ms; mean ANN round trip 779.80 ms.

The current pgvector defaults (`m=16`, `ef_construction=64`, `ef_search=40`) were retained: they achieved full recall and the best observed ANN latency in this staging-sized test. The absolute round-trip timings include the remote China-to-Neon path and should not be treated as server-only latency.

## Global historical reindex operations

Revision `34db47e` adds a fail-closed administrator endpoint for global historical backfill. It requires an explicit `LIBRARY_MAINTENANCE_ADMIN_USER_IDS` allowlist, scans by resumable document-id cursor, inspects no more than 500 rows per request, and schedules no more than 50 jobs as each document's actual owner. Five route tests cover unauthenticated, unauthorized, unconfigured, pagination, and cross-owner scheduling behavior.

The protected Preview was deployed with the staging acceptance user explicitly allowlisted. An authenticated `GET /api/admin/documents/reindex?limit=1` through the stable staging alias returned `200`, inspected one global candidate, and returned a resumable cursor. The live check was deliberately read-only: it did not schedule or mutate the legacy document.

## Remaining production-readiness boundary

The Preview deliberately ran without `EMBEDDING_API_KEY`, so the real Library lifecycle accepted the documented BM25 degradation path (`embeddingStatus=unavailable`). HNSW itself was measured with isolated synthetic vectors, but vector retrieval over a production-shaped embedded document corpus remains unverified. A credential-presence audit found no dedicated Preview embedding key; a minimal probe of the only locally named OpenAI key returned `401 invalid_api_key`, and that invalid value was not deployed.

The release smoke now has an explicit `--require-vector` gate. It requires ready embedding metadata and a real query response with `retrievalMode=hybrid` plus at least one vector-backed evidence unit, preventing a BM25 fallback from being counted as full hybrid acceptance.

The strict gate was exercised against revision `84b8b63` on the protected Preview. A 1,517,276-byte PDF uploaded in 3,704 ms, downloaded byte-identically, and completed asynchronous lexical indexing. The gate then exited non-zero with the expected missing-ready-embedding error. Its cleanup restored the count of smoke-tagged documents from zero to zero. This is evidence that degraded mode is rejected and cleaned up, not evidence that vector retrieval passed. A valid dedicated embedding credential and representative corpus run are still required before claiming the vector half of hybrid retrieval is production-accepted.
