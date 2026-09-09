-- Read-only assertions for a confirmed staging clone. Any missing capability raises an error.
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    RAISE EXCEPTION 'pgvector extension is not installed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'DocumentChunk'
      AND indexdef ILIKE '%USING hnsw%'
      AND indexdef ILIKE '%vector_cosine_ops%'
  ) THEN
    RAISE EXCEPTION 'DocumentChunk HNSW cosine index is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'DocumentChunk'
      AND column_name = 'embedding' AND udt_name = 'vector'
  ) THEN
    RAISE EXCEPTION 'DocumentChunk.embedding vector column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'DocumentChunk'
      AND column_name = 'contentKind'
  ) THEN
    RAISE EXCEPTION 'DocumentChunk.contentKind compatibility column is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '20260908173000_hybrid_rag_dag' AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'hybrid RAG/DAG migration is not recorded as finished';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '20260908203000_content_aware_chunks' AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'content-aware chunk migration is not recorded as finished';
  END IF;

  -- Compatibility reads: these expressions must remain valid for legacy rows whose
  -- hashes, embeddings, checkpoint node dependsOn fields, or output snapshots are absent.
  PERFORM COUNT(*) FROM "Document" WHERE "fileHash" IS NULL OR "embeddingModelVersion" IS NULL;
  PERFORM COUNT(*) FROM "DocumentChunk" WHERE "embedding" IS NULL OR "contentKind" = 'text';
  PERFORM COUNT(*) FROM "AgentJob" WHERE "checkpoint" IS NULL OR jsonb_typeof("checkpoint") = 'object';
  PERFORM COUNT(*) FROM "AgentNode" WHERE "inputHash" IS NULL OR "outputSnapshot" IS NULL;
END
$verify$;
