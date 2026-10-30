#!/usr/bin/env python3
"""Recompute a post-hoc NFCorpus sensitivity view excluding known corpus overlaps."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

from evaluate_nfcorpus import paired_bootstrap, read_jsonl, score_summary


def run(dataset_dir: Path, research_root: Path, predictions_dir: Path, output_dir: Path) -> dict[str, Any]:
    sys.path.insert(0, str(research_root.resolve() / "src"))
    from metrics import query_metrics

    metadata = json.loads((predictions_dir / "metrics.json").read_text(encoding="utf-8"))
    near_matches = metadata["overlap_audit"]["corpus_overlap"]["simhash_near_duplicates_hamming_at_most_3"]
    overlap_ids = {str(row["nfcorpus_id"]) for row in near_matches}
    qrel_path = dataset_dir / "qrels" / "test.tsv"
    qrels: dict[str, dict[str, int]] = {}
    with qrel_path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle):
            fields = line.rstrip("\n").split("\t")
            if line_number == 0 and fields[0] == "query-id":
                continue
            if len(fields) != 3:
                raise ValueError(f"invalid test qrels row at line {line_number + 1}")
            query_id, document_id, relevance = fields
            qrels.setdefault(query_id, {})[document_id] = int(relevance)

    output_dir.mkdir(parents=True, exist_ok=True)
    systems: dict[str, dict[str, Any]] = {}
    per_query_ndcg: dict[str, list[float]] = {}
    excluded_annotated_query_ids: set[str] = set()
    included_query_ids: set[str] = set()
    system_names = sorted(
        path.stem
        for path in predictions_dir.glob("*.jsonl")
        if path.name != "failure-cases.jsonl" and not path.stem.startswith("overlap-filtered-")
    )
    filtered_rows_by_system: dict[str, list[dict[str, Any]]] = {}

    for system in system_names:
        filtered_rows: list[dict[str, Any]] = []
        for row in read_jsonl(predictions_dir / f"{system}.jsonl"):
            query_id = str(row["query_id"])
            original_qrels = {str(doc_id): int(relevance) for doc_id, relevance in row["qrels"].items()}
            if set(original_qrels) & overlap_ids:
                excluded_annotated_query_ids.add(query_id)
            clean_qrels = {doc_id: relevance for doc_id, relevance in original_qrels.items() if doc_id not in overlap_ids}
            if not clean_qrels:
                continue
            included_query_ids.add(query_id)
            ranking = [item for item in row["ranking"] if str(item["doc_id"]) not in overlap_ids]
            metrics = query_metrics([str(item["doc_id"]) for item in ranking], clean_qrels)
            filtered_rows.append({
                "query_id": query_id,
                "query": row["query"],
                "qrels": clean_qrels,
                "ranking": ranking,
                "rerank_candidate_ids": [doc_id for doc_id in (row.get("rerank_candidate_ids") or []) if str(doc_id) not in overlap_ids] if row.get("rerank_candidate_ids") is not None else None,
                "latency_ms": row["latency_ms"],
                "metrics": metrics,
            })
        filtered_rows_by_system[system] = filtered_rows
        output_path = output_dir / f"overlap-filtered-{system}.jsonl"
        output_path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in filtered_rows), encoding="utf-8")
        systems[system] = score_summary(filtered_rows)
        per_query_ndcg[system] = [float(row["metrics"].get("nDCG@10", 0.0)) for row in filtered_rows]

    if len({tuple(row["query_id"] for row in rows) for rows in filtered_rows_by_system.values()}) > 1:
        raise ValueError("systems do not share the same overlap-filtered query set")

    comparisons: dict[str, Any] = {}
    baseline = per_query_ndcg["bm25"]
    for system, values in per_query_ndcg.items():
        if system != "bm25":
            comparisons[f"{system}_minus_bm25_nDCG10"] = paired_bootstrap(values, baseline, [20261031, 20261032, 20261033])
        if system.startswith("hybrid-rerank-finetuned-"):
            comparisons[f"{system}_minus_hybrid-rerank-pretrained_nDCG10"] = paired_bootstrap(values, per_query_ndcg["hybrid-rerank-pretrained"], [20261031, 20261032, 20261033])

    fine_systems = sorted(system for system in systems if system.startswith("hybrid-rerank-finetuned-seed-"))
    seed_mean_ndcg = [
        sum(float(filtered_rows_by_system[system][index]["metrics"].get("nDCG@10", 0.0)) for system in fine_systems) / len(fine_systems)
        for index in range(len(filtered_rows_by_system[fine_systems[0]]))
    ]
    metric_keys = ("Recall@5", "Recall@10", "Recall@20", "MRR@10", "nDCG@10")
    seed_mean_metrics = {
        key: sum(float(systems[system][key]) for system in fine_systems) / len(fine_systems)
        for key in metric_keys
    }
    full_seed_rows = {system: read_jsonl(predictions_dir / f"{system}.jsonl") for system in fine_systems}
    full_pretrained_rows = read_jsonl(predictions_dir / "hybrid-rerank-pretrained.jsonl")
    full_bm25_rows = read_jsonl(predictions_dir / "bm25.jsonl")
    full_query_ids = [str(row["query_id"]) for row in full_pretrained_rows]
    if any([str(row["query_id"]) for row in rows] != full_query_ids for rows in full_seed_rows.values()):
        raise ValueError("full-test reranker predictions do not share the same query order")
    full_seed_mean_ndcg = [
        sum(float(full_seed_rows[system][index]["metrics"].get("nDCG@10", 0.0)) for system in fine_systems) / len(fine_systems)
        for index in range(len(full_query_ids))
    ]
    full_pretrained_ndcg = [float(row["metrics"].get("nDCG@10", 0.0)) for row in full_pretrained_rows]
    full_bm25_ndcg = [float(row["metrics"].get("nDCG@10", 0.0)) for row in full_bm25_rows]
    full_seed_mean_metrics = {
        key: sum(float(metadata["systems"][system][key]) for system in fine_systems) / len(fine_systems)
        for key in metric_keys
    }

    result = {
        "status": "post-hoc sensitivity analysis; original NFCorpus full-test metrics remain in metrics.json",
        "corpus_overlap_filter": {
            "excluded_nfcorpus_document_ids": sorted(overlap_ids),
            "excluded_document_count": len(overlap_ids),
            "queries_with_at_least_one_qrel_document_removed": len(excluded_annotated_query_ids),
            "included_queries_with_remaining_qrels": len(included_query_ids),
            "included_query_ids_sha256": hashlib.sha256("\n".join(sorted(included_query_ids)).encode()).hexdigest(),
            "method": "Remove all stored SimHash candidate-overlap documents from each saved ranking and its qrels; omit a query only if no judged relevant document remains. This filters saved candidate lists and does not rerun corpus retrieval or refill top-k.",
        },
        "candidate_pool_note": "Every pretrained/fine-tuned reranker started with the same Hybrid top-50 candidates for every query; filtering removes the same overlap IDs from those candidate lists.",
        "systems": systems,
        "full_test_fine_tuned_seed_average": {
            "interpretation": "Arithmetic mean across three trained checkpoints; not an ensemble model.",
            "training_seed_count": len(fine_systems),
            "mean_metrics": full_seed_mean_metrics,
            "paired_bootstrap_vs_bm25_nDCG10": paired_bootstrap(full_seed_mean_ndcg, full_bm25_ndcg, [20261031, 20261032, 20261033]),
            "paired_bootstrap_vs_pretrained_nDCG10": paired_bootstrap(full_seed_mean_ndcg, full_pretrained_ndcg, [20261031, 20261032, 20261033]),
        },
        "fine_tuned_seed_average": {
            "interpretation": "Arithmetic mean of three separately trained checkpoint metrics; this is not an ensemble model or a fourth training run.",
            "training_seed_count": len(fine_systems),
            "mean_metrics": seed_mean_metrics,
            "paired_bootstrap_vs_bm25_nDCG10": paired_bootstrap(seed_mean_ndcg, per_query_ndcg["bm25"], [20261031, 20261032, 20261033]),
            "paired_bootstrap_vs_pretrained_nDCG10": paired_bootstrap(seed_mean_ndcg, per_query_ndcg["hybrid-rerank-pretrained"], [20261031, 20261032, 20261033]),
        },
        "paired_bootstrap": {
            "metric": "per-query nDCG@10 mean difference, paired query bootstrap",
            "confidence_level": 0.95,
            "bootstrap_seeds": [20261031, 20261032, 20261033],
            "samples_per_seed": 2000,
            "interval_note": "Intervals resample test queries and do not estimate between-training-seed uncertainty.",
            "comparisons": comparisons,
        },
    }
    (output_dir / "overlap-filtered-metrics.json").write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-dir", type=Path, required=True)
    parser.add_argument("--research-root", type=Path, required=True)
    parser.add_argument("--predictions-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.dataset_dir, args.research_root, args.predictions_dir, args.output_dir), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
