# Legacy `file://` Library Migration

This migration is intentionally copy-only. It must not delete, move, truncate, or overwrite any legacy local file. Database migrations do not perform object copies or filesystem cleanup.

## Preconditions

- Work on a staging clone of the database and a read-only snapshot/copy of the legacy Library directory.
- Configure private Blob storage for staging.
- Record each source document id, current `fileUrl`, file size, and SHA-256 digest in an append-only migration manifest.
- Reject any `file://` path that does not resolve inside the configured legacy Library root.

## Per-document procedure

1. Read the original local file without modifying it.
2. Compute its byte length and SHA-256 digest.
3. Upload the bytes to a deterministic, user-scoped private object key.
4. Read the newly uploaded object back from Blob.
5. Compare the returned byte length and SHA-256 digest with the original.
6. Run parsing/indexing against the copied object and verify at least one retrievable chunk, or record an explicit index failure without changing the reference.
7. Only after byte and retrieval verification succeeds, conditionally update that document's database `fileUrl` from the exact old value to the new `object://` reference. A changed/missing row is a conflict and must not be overwritten.
8. Append the object reference, verification results, and database update result to the manifest.

Failures stop that document before the database reference changes. A rerun first checks the manifest and current database value, making verified documents idempotent and conflicts visible.

## Verification

- Fetch every migrated document through `/api/documents/:id/file` and compare its digest with the manifest.
- Query `/api/documents/context` with a unique phrase from the document and confirm a bounded chunk is returned.
- Confirm the application exposes an `object://` reference for migrated rows and still reads untouched `file://` rows.
- Keep the original files and the manifest for the full rollback/retention window.

## Rollback and cleanup

Rollback changes only the database reference back to the manifest's original `file://` value after confirming the original file still exists and matches its recorded digest. The copied Blob object may remain until a separate cleanup review.

Deleting original local files is explicitly outside this migration. It requires a later, separately approved retention policy, a second complete verification pass, a recoverable backup, and its own audit log.
