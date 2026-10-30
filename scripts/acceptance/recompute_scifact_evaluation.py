#!/usr/bin/env python3
"""Independently recompute saved ScholarKernel-Reranker SciFact metrics."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
import subprocess
from pathlib import Path
from typing import Any


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def directory_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(str(file_path.relative_to(path)).encode())
        digest.update(file_path.read_bytes())
    return digest.hexdigest()


def score_query(ranked_ids: list[str], qrels: dict[str, int]) -> dict[str, Any]:
    if not qrels:
        return {"eligible": False}
    relevant = set(qrels)
    ranks = [index + 1 for index, doc_id in enumerate(ranked_ids) if doc_id in relevant]
    first_rank = min(ranks) if ranks else None
    dcg = sum(
        (2 ** qrels.get(doc_id, 0) - 1) / math.log2(index + 2)
        for index, doc_id in enumerate(ranked_ids[:10])
    )
    idcg = sum(1 / math.log2(index + 2) for index in range(min(len(relevant), 10)))
    result: dict[str, Any] = {
        "eligible": True,
        "no_relevant_in_top20": not any(doc_id in relevant for doc_id in ranked_ids[:20]),
        "MRR@10": 1 / first_rank if first_rank is not None and first_rank <= 10 else 0.0,
        "nDCG@10": dcg / idcg if idcg else 0.0,
    }
    for cutoff in (5, 10, 20):
        result[f"Recall@{cutoff}"] = len(set(ranked_ids[:cutoff]) & relevant) / len(relevant)
    return result


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    eligible = [row for row in rows if row.get("eligible")]
    metrics = ("Recall@5", "Recall@10", "Recall@20", "MRR@10", "nDCG@10")
    return {
        "query_count": len(rows),
        "eligible_query_count": len(eligible),
        "unlabeled_query_count": len(rows) - len(eligible),
        "queries_with_no_relevant_in_top20": sum(bool(row["no_relevant_in_top20"]) for row in eligible),
        **{name: sum(float(row[name]) for row in eligible) / len(eligible) if eligible else None for name in metrics},
    }


def normalized_claim(text: str) -> str:
    # Match the preprocessing used by the training code.
    return text.strip().casefold()


def official_qrels(query: dict[str, Any]) -> dict[str, int]:
    return {
        str(document_id): 1
        for document_id, annotations in (query.get("evidence") or {}).items()
        if isinstance(annotations, list)
        and any(isinstance(item, dict) and item.get("label") in {"SUPPORT", "CONTRADICT"} for item in annotations)
    }


def char_fivegrams(text: str) -> set[str]:
    tokens = re.findall(r"[a-z0-9]+", " ".join(text.strip().casefold().split()))
    normalized = " ".join(tokens)
    if not normalized:
        return set()
    if len(normalized) < 5:
        return {normalized}
    return {normalized[index : index + 5] for index in range(len(normalized) - 4)}


def near_duplicate_counts(train: list[dict[str, Any]], dev: list[dict[str, Any]]) -> dict[str, int]:
    dev_sets = [(row, char_fivegrams(str(row["claim"]))) for row in dev]
    pairs_80 = 0
    pairs_90 = 0
    for train_row in train:
        train_text = normalized_claim(str(train_row["claim"]))
        train_set = char_fivegrams(str(train_row["claim"]))
        for dev_row, dev_set in dev_sets:
            if train_text == normalized_claim(str(dev_row["claim"])):
                continue
            union = train_set | dev_set
            similarity = len(train_set & dev_set) / len(union) if union else 1.0
            pairs_80 += similarity >= 0.8
            pairs_90 += similarity >= 0.9
    return {"char5gram_jaccard_ge_0_8": pairs_80, "char5gram_jaccard_ge_0_9": pairs_90}


def paired_bootstrap(differences: dict[str, float], seed: int, repetitions: int) -> dict[str, Any]:
    query_ids = sorted(differences)
    if not query_ids:
        return {"query_count": 0, "mean_difference": None, "ci_95": None}
    rng = random.Random(seed)
    samples = sorted(
        sum(differences[rng.choice(query_ids)] for _ in query_ids) / len(query_ids)
        for _ in range(repetitions)
    )
    low = samples[int(0.025 * repetitions)]
    high = samples[min(repetitions - 1, int(0.975 * repetitions))]
    return {
        "query_count": len(query_ids),
        "mean_difference": sum(differences.values()) / len(query_ids),
        "ci_95": [low, high],
        "method": "paired query bootstrap percentile interval",
        "seed": seed,
        "repetitions": repetitions,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("reranker_repo", type=Path, help="Path to the local ScholarKernel-reranker checkout")
    parser.add_argument("--seed", type=int, default=20261030)
    parser.add_argument("--bootstrap-repetitions", type=int, default=10_000)
    args = parser.parse_args()
    root = args.reranker_repo.resolve()
    base = root / "results" / "phase3-baseline"
    fine = root / "results" / "phase3-finetuned"
    manifest = read_json(root / "data" / "manifest.json")
    training = read_json(root / "results" / "training" / "training-summary.json")
    corpus = root / "data" / "processed" / "corpus.jsonl"
    train_path = root / "data" / "processed" / "claims_train.jsonl"
    dev_path = root / "data" / "processed" / "claims_dev.jsonl"
    archive = root / "data" / "raw" / "scifact-data.tar.gz"

    train = read_jsonl(train_path)
    dev = read_jsonl(dev_path)
    dev_by_id = {str(row["id"]): row for row in dev}
    corpus_rows = read_jsonl(corpus)
    corpus_ids = {str(row["doc_id"]) for row in corpus_rows}
    dev_normalized = {normalized_claim(str(row["claim"])) for row in dev}
    exact_pairs = sum(normalized_claim(str(row["claim"])) in dev_normalized for row in train)
    retained_train = [row for row in train if normalized_claim(str(row["claim"])) not in dev_normalized]
    id_overlap = len({str(row["id"]) for row in train} & {str(row["id"]) for row in dev})
    processed_hashes = {
        name: sha256(root / "data" / "processed" / name) == metadata["sha256"]
        for name, metadata in manifest["selected_files"].items()
    }
    checkpoint = root / training["checkpoint_path"]
    checkpoint_exists = checkpoint.is_dir()
    checkpoint_hash = directory_sha256(checkpoint) if checkpoint_exists else None
    checkpoint_file = checkpoint / "model.safetensors"
    tracked_checkpoint = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--error-unmatch", str(checkpoint_file.relative_to(root))],
        capture_output=True,
        text=True,
        check=False,
    ).returncode == 0

    system_paths = {
        "bm25": base / "bm25.jsonl",
        "dense": base / "dense.jsonl",
        "hybrid": base / "hybrid.jsonl",
        "hybrid-rerank": base / "hybrid-rerank.jsonl",
        "hybrid-rerank-finetuned": fine / "hybrid-rerank-finetuned.jsonl",
    }
    systems: dict[str, dict[str, dict[str, Any]]] = {}
    fresh_scores: dict[str, dict[str, dict[str, Any]]] = {}
    recomputed: dict[str, Any] = {}
    summary_differences: dict[str, Any] = {}
    for name, path in system_paths.items():
        rows = read_jsonl(path)
        systems[name] = {str(row["query_id"]): row for row in rows}
        fresh_scores[name] = {}
        dataset_checks = {
            "duplicate_query_rows": len(rows) - len(systems[name]),
            "unknown_query_ids": len(set(systems[name]) - set(dev_by_id)),
            "missing_query_ids": len(set(dev_by_id) - set(systems[name])),
            "claim_mismatches": 0,
            "qrel_mismatches": 0,
            "duplicate_ranked_document_rows": 0,
            "unknown_ranked_documents": 0,
        }
        scored_rows: list[dict[str, Any]] = []
        mismatches = 0
        for row in rows:
            query_id = str(row["query_id"])
            original = dev_by_id.get(query_id, {})
            qrels = official_qrels(original)
            stored_qrels = {str(key): int(value) for key, value in row["qrels"].items()}
            dataset_checks["claim_mismatches"] += row.get("claim") != original.get("claim")
            dataset_checks["qrel_mismatches"] += stored_qrels != qrels
            ranked_ids = [str(hit["doc_id"]) for hit in row["ranking"]]
            dataset_checks["duplicate_ranked_document_rows"] += len(ranked_ids) != len(set(ranked_ids))
            dataset_checks["unknown_ranked_documents"] += sum(doc_id not in corpus_ids for doc_id in ranked_ids)
            score = score_query(ranked_ids, qrels)
            fresh_scores[name][query_id] = score
            scored_rows.append(score)
            for key, value in score.items():
                if row["metrics"].get(key) != value and not (
                    isinstance(value, float)
                    and row["metrics"].get(key) is not None
                    and abs(float(row["metrics"][key]) - value) <= 1e-12
                ):
                    mismatches += 1
        actual = summarize(scored_rows)
        recomputed[name] = {"rows": len(rows), "metrics": actual, "per_query_metric_mismatches": mismatches, "official_data_checks": dataset_checks}
        summary_path = base / "metrics.json" if name != "hybrid-rerank-finetuned" else fine / "metrics.json"
        reported = read_json(summary_path)["systems"][name]
        summary_differences[name] = {
            metric: abs(float(reported[metric]) - float(actual[metric]))
            for metric in ("Recall@5", "Recall@10", "Recall@20", "MRR@10", "nDCG@10")
        }

    shared_ids = set(systems["hybrid-rerank"]) & set(systems["hybrid-rerank-finetuned"])
    pretrained_sets = {query_id: {hit["doc_id"] for hit in systems["hybrid-rerank"][query_id]["ranking"]} for query_id in shared_ids}
    finetuned_sets = {query_id: {hit["doc_id"] for hit in systems["hybrid-rerank-finetuned"][query_id]["ranking"]} for query_id in shared_ids}
    hybrid_top50_diff = sum(
        {hit["doc_id"] for hit in systems["hybrid"][query_id]["ranking"][:50]} != pretrained_sets[query_id]
        for query_id in shared_ids
    )
    reranker_pool_diff = sum(pretrained_sets[query_id] != finetuned_sets[query_id] for query_id in shared_ids)
    eligible_ids = [query_id for query_id in sorted(shared_ids) if fresh_scores["hybrid-rerank"][query_id].get("eligible")]
    differences = {
        query_id: float(fresh_scores["hybrid-rerank-finetuned"][query_id]["nDCG@10"])
        - float(fresh_scores["hybrid-rerank"][query_id]["nDCG@10"])
        for query_id in eligible_ids
    }

    result = {
        "repository": str(root),
        "dataset": {
            "archive_sha256_matches_manifest": sha256(archive) == manifest["archive_sha256"],
            "processed_file_hashes_match_manifest": processed_hashes,
            "corpus_documents": len(corpus_rows),
        },
        "split": {
            "train_claim_count": len(train),
            "dev_claim_count": len(dev),
            "claim_id_overlap": id_overlap,
            "exact_normalized_train_dev_claim_text_pairs": exact_pairs,
            **near_duplicate_counts(retained_train, dev),
            "near_duplicate_metric": "character 5-gram Jaccard over lowercase English alphanumeric text; exact text pairs excluded",
        },
        "checkpoint": {
            "exists": checkpoint_exists,
            "sha256": checkpoint_hash,
            "matches_training_summary": checkpoint_hash == training["checkpoint_sha256"],
            "model_weights_tracked_by_git": tracked_checkpoint,
        },
        "recomputed_systems": recomputed,
        "reported_summary_absolute_metric_difference": summary_differences,
        "reranker_candidate_pools": {
            "shared_queries": len(shared_ids),
            "pretrained_vs_finetuned_set_differences": reranker_pool_diff,
            "hybrid_top50_vs_pretrained_reranker_set_differences": hybrid_top50_diff,
        },
        "finetuned_minus_pretrained_ndcg10": paired_bootstrap(differences, args.seed, args.bootstrap_repetitions),
        "limitations": [
            "The dev split was used for epoch selection and is not an untouched test set.",
            "The interval is exploratory because model selection and the reported estimate use the same dev data.",
            "High lexical overlap is not proof of semantic leakage; clinical claims may differ by a single token or number.",
        ],
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
