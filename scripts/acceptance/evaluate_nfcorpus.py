#!/usr/bin/env python3
"""Evaluate fixed retrieval systems on BEIR NFCorpus test without model APIs."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
import time
from pathlib import Path
from typing import Any

import numpy as np
import torch


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def normalize_words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.casefold())


def jaccard(left: set[str], right: set[str]) -> float:
    return len(left & right) / len(left | right) if left or right else 0.0


def simhash(text: str, bits: int = 64) -> int:
    tokens = normalize_words(text)
    shingles = [" ".join(tokens[index:index + 3]) for index in range(max(1, len(tokens) - 2))]
    totals = [0] * bits
    for shingle in set(shingles):
        value = int.from_bytes(hashlib.blake2b(shingle.encode("utf-8"), digest_size=8).digest(), "big")
        for index in range(bits):
            totals[index] += 1 if value & (1 << index) else -1
    return sum((1 << index) for index, total in enumerate(totals) if total >= 0)


def overlap_report(dataset_dir: Path, research_root: Path, queries: list[dict[str, Any]], corpus: list[dict[str, Any]]) -> dict[str, Any]:
    train_queries = read_jsonl(research_root / "data" / "processed" / "claims_train.jsonl")
    dev_queries = read_jsonl(research_root / "data" / "processed" / "claims_dev.jsonl")
    reference_queries = train_queries + dev_queries
    reference_tokens = [(str(row.get("claim", "")), set(normalize_words(str(row.get("claim", ""))))) for row in reference_queries]
    query_overlaps: list[dict[str, Any]] = []
    exact_query_pairs = 0
    near_query_pairs = 0
    very_near_query_pairs = 0
    for query in queries:
        text = str(query["text"])
        tokens = set(normalize_words(text))
        best_score = 0.0
        best_claim = ""
        for claim, claim_tokens in reference_tokens:
            score = jaccard(tokens, claim_tokens)
            if score > best_score:
                best_score = score
                best_claim = claim
            if text.casefold().strip() == claim.casefold().strip():
                exact_query_pairs += 1
        if best_score >= 0.8:
            very_near_query_pairs += 1
        if best_score >= 0.65:
            near_query_pairs += 1
        query_overlaps.append({"query_id": str(query["_id"]), "max_train_or_dev_word_jaccard": round(best_score, 4), "nearest_claim": best_claim})

    nf_titles = {" ".join(normalize_words(str(row.get("title", "")))) for row in corpus}
    nf_texts = {hashlib.sha256(" ".join(normalize_words(str(row.get("title", "")) + " " + str(row.get("text", "")))).encode()).hexdigest() for row in corpus}
    scifact = read_jsonl(research_root / "data" / "processed" / "corpus.jsonl")
    sc_titles = {" ".join(normalize_words(str(row.get("title", "")))) for row in scifact}
    sc_texts: set[str] = set()
    sc_hashes: list[int] = []
    for row in scifact:
        abstract = row.get("abstract", [])
        body = " ".join(str(sentence) for sentence in abstract) if isinstance(abstract, list) else str(abstract)
        text = str(row.get("title", "")) + " " + body
        normalized = " ".join(normalize_words(text))
        sc_texts.add(hashlib.sha256(normalized.encode()).hexdigest())
        sc_hashes.append(simhash(text))
    exact_title_overlap = len({title for title in nf_titles & sc_titles if title})
    exact_text_overlap = len(nf_texts & sc_texts)
    near_doc_matches: list[dict[str, Any]] = []
    for nf_row in corpus:
        text = str(nf_row.get("title", "")) + " " + str(nf_row.get("text", ""))
        signature = simhash(text)
        best = (65, -1)
        for index, candidate in enumerate(sc_hashes):
            distance = (signature ^ candidate).bit_count()
            if distance < best[0]:
                best = (distance, index)
        if best[0] <= 3 and best[1] >= 0:
            sc_row = scifact[best[1]]
            near_doc_matches.append({"nfcorpus_id": str(nf_row["_id"]), "scifact_id": str(sc_row.get("doc_id")), "simhash_hamming_distance": best[0], "nfcorpus_title": nf_row.get("title"), "scifact_title": sc_row.get("title")})
    return {
        "query_overlap": {
            "reference_splits": ["SciFact train", "SciFact dev"],
            "exact_normalized_query_pairs": exact_query_pairs,
            "queries_with_word_shingle_jaccard_at_least_0_65": near_query_pairs,
            "queries_with_word_shingle_jaccard_at_least_0_80": very_near_query_pairs,
            "maximum_pairs": sorted(query_overlaps, key=lambda row: row["max_train_or_dev_word_jaccard"], reverse=True)[:10],
        },
        "corpus_overlap": {
            "scifact_corpus_count": len(scifact),
            "nfcorpus_corpus_count": len(corpus),
            "exact_normalized_title_overlap": exact_title_overlap,
            "exact_normalized_title_and_text_overlap": exact_text_overlap,
            "simhash_near_duplicates_hamming_at_most_3": near_doc_matches,
            "simhash_method": "64-bit SimHash of unique normalized word 3-shingles; <=3 bit distance is a candidate, not a verified duplicate",
        },
    }


def rrf(rankings: list[list[tuple[str, float]]], limit: int, k: int = 60) -> list[tuple[str, float]]:
    scores: dict[str, float] = {}
    first_rank: dict[str, int] = {}
    for ranking in rankings:
        for rank, (doc_id, _score) in enumerate(ranking, start=1):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1 / (k + rank)
            first_rank[doc_id] = min(first_rank.get(doc_id, rank), rank)
    return sorted(scores.items(), key=lambda row: (-row[1], first_rank[row[0]], row[0]))[:limit]


def score_summary(per_query: list[dict[str, Any]]) -> dict[str, Any]:
    eligible = [row for row in per_query if row["metrics"].get("eligible")]
    keys = ("Recall@5", "Recall@10", "Recall@20", "MRR@10", "nDCG@10")
    return {
        "query_count": len(per_query),
        "eligible_query_count": len(eligible),
        "queries_with_no_relevant_in_top20": sum(bool(row["metrics"]["no_relevant_in_top20"]) for row in eligible),
        **{key: sum(float(row["metrics"][key]) for row in eligible) / len(eligible) if eligible else None for key in keys},
        "latency_p50_ms": float(np.percentile([row["latency_ms"] for row in per_query], 50)) if per_query else None,
        "latency_p95_ms": float(np.percentile([row["latency_ms"] for row in per_query], 95)) if per_query else None,
    }


def paired_bootstrap(left: list[float], right: list[float], seeds: list[int], samples: int = 2000) -> list[dict[str, Any]]:
    if len(left) != len(right) or not left:
        return []
    output = []
    for seed in seeds:
        rng = random.Random(seed)
        deltas: list[float] = []
        for _ in range(samples):
            indexes = [rng.randrange(len(left)) for _ in range(len(left))]
            deltas.append(sum(left[index] - right[index] for index in indexes) / len(indexes))
        deltas.sort()
        output.append({"seed": seed, "samples": samples, "mean_delta": sum(left[index] - right[index] for index in range(len(left))) / len(left), "ci95": [deltas[int(0.025 * samples)], deltas[min(samples - 1, int(0.975 * samples))]]})
    return output


def run(args: argparse.Namespace) -> dict[str, Any]:
    research_root = args.research_root.resolve()
    sys.path.insert(0, str(research_root / "src"))
    from bm25 import BM25Index
    from metrics import query_metrics
    from model_utils import (
        CROSS_ENCODER_MODEL_ID, CROSS_ENCODER_REVISION,
        EMBEDDING_MODEL_ID, EMBEDDING_REVISION,
        choose_device, encode_texts, load_cross_encoder, load_embedding_model, score_pairs,
    )

    dataset_dir = args.dataset_dir.resolve()
    corpus = sorted(read_jsonl(dataset_dir / "corpus.jsonl"), key=lambda row: str(row["_id"]))
    all_queries = read_jsonl(dataset_dir / "queries.jsonl")
    query_by_id = {str(row["_id"]): row for row in all_queries}
    qrels: dict[str, dict[str, int]] = {}
    with (dataset_dir / "qrels" / "test.tsv").open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle):
            fields = line.rstrip("\n").split("\t")
            if line_number == 0 and fields[0] == "query-id":
                continue
            if len(fields) != 3:
                raise ValueError(f"invalid test qrels row at line {line_number + 1}")
            qid, docid, relevance = fields
            qrels.setdefault(qid, {})[docid] = int(relevance)
    queries = sorted((query_by_id[qid] for qid in qrels if qid in query_by_id), key=lambda row: str(row["_id"]))
    if len(queries) != len(qrels):
        raise ValueError("test qrels contain query ids missing from queries.jsonl")
    corpus_by_id = {str(row["_id"]): row for row in corpus}
    missing_qrel_docs = sorted({doc_id for query_qrels in qrels.values() for doc_id in query_qrels if doc_id not in corpus_by_id})
    if missing_qrel_docs:
        raise ValueError(f"qrels refer to missing corpus IDs, examples: {missing_qrel_docs[:5]}")

    doc_texts = [" ".join(part for part in (str(row.get("title", "")), str(row.get("text", ""))) if part) for row in corpus]
    doc_ids = [str(row["_id"]) for row in corpus]
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    system_predictions: dict[str, list[dict[str, Any]]] = {name: [] for name in ("bm25", "dense", "hybrid", "hybrid-rerank-pretrained")}
    fine_paths: list[tuple[int, Path]] = []
    for spec in args.finetuned_seed:
        seed_text, path_text = spec.split("=", 1)
        fine_paths.append((int(seed_text), Path(path_text).resolve()))
        system_predictions[f"hybrid-rerank-finetuned-seed-{seed_text}"] = []

    index_started = time.perf_counter()
    bm25 = BM25Index(list(zip(doc_ids, doc_texts, strict=True)))
    bm25_build_ms = (time.perf_counter() - index_started) * 1000
    device = choose_device()
    embedding_started = time.perf_counter()
    embed_tokenizer, embed_model, device = load_embedding_model(device)
    doc_vectors = encode_texts(doc_texts, embed_tokenizer, embed_model, device)
    embedding_index_ms = (time.perf_counter() - embedding_started) * 1000
    pretrained_tokenizer, pretrained_model, device = load_cross_encoder(device)
    fine_models = []
    for seed, path in fine_paths:
        tokenizer, model, device = load_cross_encoder(device, checkpoint=path)
        fine_models.append((seed, path, tokenizer, model))

    latency_values: dict[str, list[float]] = {name: [] for name in system_predictions}
    for query in queries:
        qid = str(query["_id"])
        text = str(query["text"])
        tick = time.perf_counter()
        bm25_hits = bm25.rank(text, 100)
        bm25_ranking = [(hit.doc_id, hit.score) for hit in bm25_hits]
        bm25_latency = (time.perf_counter() - tick) * 1000

        tick = time.perf_counter()
        query_vector = encode_texts([text], embed_tokenizer, embed_model, device, batch_size=1)[0]
        dense_scores = doc_vectors @ query_vector
        dense_indexes = np.argsort(-dense_scores, kind="stable")[:100]
        dense_ranking = [(doc_ids[int(index)], float(dense_scores[int(index)])) for index in dense_indexes]
        dense_latency = (time.perf_counter() - tick) * 1000

        tick = time.perf_counter()
        hybrid_ranking = rrf([bm25_ranking, dense_ranking], 100)
        hybrid_latency = (time.perf_counter() - tick) * 1000
        candidate_pool = hybrid_ranking[:50]
        pairs = [(text, " ".join(part for part in (str(corpus_by_id[doc_id].get("title", "")), str(corpus_by_id[doc_id].get("text", ""))) if part)) for doc_id, _score in candidate_pool]

        predictions: dict[str, tuple[list[tuple[str, float]], float, float | None]] = {
            "bm25": (bm25_ranking, bm25_latency, None),
            "dense": (dense_ranking, dense_latency, None),
            "hybrid": (hybrid_ranking, bm25_latency + dense_latency + hybrid_latency, None),
        }
        tick = time.perf_counter()
        pretrained_scores = score_pairs(pairs, pretrained_tokenizer, pretrained_model, device)
        pretrained_latency = (time.perf_counter() - tick) * 1000
        pretrained_ranked = sorted(((candidate_pool[index][0], pretrained_scores[index]) for index in range(len(candidate_pool))), key=lambda row: (-row[1], row[0]))
        predictions["hybrid-rerank-pretrained"] = (pretrained_ranked, bm25_latency + dense_latency + hybrid_latency + pretrained_latency, pretrained_latency)
        for seed, _path, tokenizer, model in fine_models:
            tick = time.perf_counter()
            fine_scores = score_pairs(pairs, tokenizer, model, device)
            fine_latency = (time.perf_counter() - tick) * 1000
            fine_ranked = sorted(((candidate_pool[index][0], fine_scores[index]) for index in range(len(candidate_pool))), key=lambda row: (-row[1], row[0]))
            predictions[f"hybrid-rerank-finetuned-seed-{seed}"] = (fine_ranked, bm25_latency + dense_latency + hybrid_latency + fine_latency, fine_latency)

        for system, (ranking, latency_ms, rerank_latency_ms) in predictions.items():
            latency_values[system].append(latency_ms)
            metrics = query_metrics([doc_id for doc_id, _ in ranking], qrels[qid])
            system_predictions[system].append({
                "query_id": qid,
                "query": text,
                "qrels": qrels[qid],
                "ranking": [{"doc_id": doc_id, "score": float(score)} for doc_id, score in ranking],
                "rerank_candidate_ids": [doc_id for doc_id, _ in candidate_pool] if "rerank" in system else None,
                "latency_ms": round(latency_ms, 4),
                "rerank_stage_latency_ms": round(rerank_latency_ms, 4) if rerank_latency_ms is not None else None,
                "metrics": metrics,
            })

    summaries: dict[str, dict[str, Any]] = {}
    failures: list[dict[str, Any]] = []
    ndcg_by_system: dict[str, list[float]] = {}
    for system, rows in system_predictions.items():
        prediction_path = output_dir / f"{system}.jsonl"
        prediction_path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
        summaries[system] = score_summary(rows)
        ndcg_by_system[system] = [float(row["metrics"].get("nDCG@10", 0.0)) for row in rows]
        for row in rows:
            if row["metrics"].get("no_relevant_in_top20"):
                failures.append({"system": system, **row})

    paired_cis: dict[str, Any] = {}
    seeds = [20261031, 20261032, 20261033]
    baseline = ndcg_by_system["bm25"]
    for system, values in ndcg_by_system.items():
        if system == "bm25":
            continue
        paired_cis[f"{system}_minus_bm25_nDCG10"] = paired_bootstrap(values, baseline, seeds)
    for system, values in ndcg_by_system.items():
        if system.startswith("hybrid-rerank-finetuned-"):
            paired_cis[f"{system}_minus_pretrained_nDCG10"] = paired_bootstrap(values, ndcg_by_system["hybrid-rerank-pretrained"], seeds)

    overlap = overlap_report(dataset_dir, research_root, queries, corpus)
    archive_path = dataset_dir.parents[1] / "nfcorpus.zip"
    metadata = {
        "dataset": "BEIR NFCorpus official test split",
        "dataset_archive_sha256": sha256_file(archive_path) if archive_path.exists() else None,
        "corpus_jsonl_sha256": sha256_file(dataset_dir / "corpus.jsonl"),
        "queries_jsonl_sha256": sha256_file(dataset_dir / "queries.jsonl"),
        "test_qrels_sha256": sha256_file(dataset_dir / "qrels" / "test.tsv"),
        "counts": {"corpus_documents": len(corpus), "all_queries": len(all_queries), "test_queries": len(queries), "eligible_test_queries": sum(bool(qrels.get(str(query["_id"]))) for query in queries)},
        "candidate_pool": {"dense_top_k": 100, "bm25_top_k": 100, "hybrid_rrf_top_k": 100, "both_pretrained_and_finetuned_rerankers_score_same_top_k": 50},
        "models": {"embedding": {"id": EMBEDDING_MODEL_ID, "revision": EMBEDDING_REVISION}, "pretrained_reranker": {"id": CROSS_ENCODER_MODEL_ID, "revision": CROSS_ENCODER_REVISION}, "finetuned_rerankers": [{"seed": seed, "checkpoint_label": path.name, "checkpoint_sha256": sha256_tree(path)} for seed, path, _tokenizer, _model in fine_models]},
        "device": str(device),
        "index_build_ms": {"bm25": bm25_build_ms, "dense_embeddings": embedding_index_ms},
        "systems": summaries,
        "paired_bootstrap": {"metric": "per-query nDCG@10 mean difference; query resampling paired within each sample", "confidence_level": 0.95, "bootstrap_seeds": seeds, "samples_per_seed": 2000, "note": "These are query-bootstrap RNG seeds. Model training seeds are the separately listed fine-tuned checkpoint seeds." , "comparisons": paired_cis},
        "overlap_audit": overlap,
        "failure_count": len(failures),
        "runtime_note": "Local pinned open-source models only; offline cache required; no external model APIs, user files, or model calls were used.",
    }
    (output_dir / "metrics.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (output_dir / "failure-cases.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in failures), encoding="utf-8")
    return metadata


def sha256_tree(path: Path) -> str:
    digest = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(str(file_path.relative_to(path)).encode("utf-8"))
        digest.update(file_path.read_bytes())
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, required=True, help="Extracted BEIR nfcorpus directory")
    parser.add_argument("--research-root", type=Path, required=True, help="ScholarKernel-reranker checkout with cached SciFact train/dev and source modules")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--finetuned-seed", action="append", default=[], metavar="SEED=CHECKPOINT_PATH")
    args = parser.parse_args()
    print(json.dumps(run(args), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
