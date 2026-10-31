#!/usr/bin/env python3
"""Prepare three-condition answer-evaluation requests and score human annotations."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE = ROOT / "docs" / "acceptance" / "fixtures" / "citation-support-v1.jsonl"
VARIANTS = ("single-agent", "multi-agent-no-collaboration", "collaborative-multi-agent")
LEGACY_VARIANTS = {"multi-agent": "multi-agent-no-collaboration"}
SUPPORT_LABELS = {"supported", "partially_supported", "contradicted", "insufficient_evidence"}
CITATION_TOKEN = re.compile(r"\[(\d+)\]")
BRACKET_TOKEN = re.compile(r"\[([^\[\]]+)\]")


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if line.strip():
                try:
                    value = json.loads(line)
                except json.JSONDecodeError as error:
                    raise ValueError(f"{path}:{line_number}: invalid JSON: {error.msg}") from error
                if not isinstance(value, dict):
                    raise ValueError(f"{path}:{line_number}: each row must be a JSON object")
                rows.append(value)
    return rows


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def prepare_requests(fixture: Path, output: Path, model: str, budget: int) -> int:
    tasks = read_jsonl(fixture)
    taskset_hash = sha256_file(fixture)
    requests: list[dict[str, Any]] = []
    for task in tasks:
        evidence = task.get("evidence")
        if not isinstance(evidence, list) or not evidence:
            raise ValueError(f"task {task.get('task_id')!r} has no evidence context")
        sources = [
            {
                "citation_token": f"[{index}]",
                "source_id": item["source_id"],
                "title": item.get("title"),
                "text": item["text"],
                "page_number": item.get("page_number"),
            }
            for index, item in enumerate(evidence, start=1)
        ]
        protocols = {
            "single-agent": "Use one agent to evaluate the supplied evidence and produce the concise answer.",
            "multi-agent-no-collaboration": "Use separate research and synthesis agents. The synthesis agent must not receive the research agent's intermediate findings; both agents may only use the supplied evidence.",
            "collaborative-multi-agent": "Use separate research and synthesis agents and share intermediate findings between them. Every factual statement must remain grounded in the supplied evidence.",
        }
        for variant in VARIANTS:
            protocol = protocols[variant]
            requests.append({
                "task_id": task["task_id"],
                "variant": variant,
                "model": model,
                "token_budget": budget,
                "prompt_version": "citation-support-v1",
                "taskset_sha256": taskset_hash,
                "status": "pending_generation",
                "question": task["claim"],
                "instruction": f"{task['prompt']} {protocol}",
                "sources": sources,
            })
    write_jsonl(output, requests)
    return len(requests)


def score_answer(row: dict[str, Any], allowed_sources: set[str]) -> dict[str, Any]:
    answer = row.get("answer")
    source_rows = row.get("sources")
    claims = row.get("claims")
    if not isinstance(answer, str) or not isinstance(source_rows, list) or not isinstance(claims, list):
        raise ValueError("each answer row needs string answer, sources array, and human-annotated claims array")

    source_by_token: dict[str, str] = {}
    for source in source_rows:
        if not isinstance(source, dict) or not isinstance(source.get("citation_token"), str) or not isinstance(source.get("source_id"), str):
            raise ValueError("each source needs citation_token and source_id strings")
        token = source["citation_token"]
        if not re.fullmatch(r"\[\d+\]", token):
            raise ValueError(f"unsupported citation token {token!r}; expected [n]")
        source_by_token[token] = source["source_id"]

    all_brackets = BRACKET_TOKEN.findall(answer)
    parsed_tokens = [match.group(0) for match in CITATION_TOKEN.finditer(answer)]
    resolved_tokens = [token for token in parsed_tokens if token in source_by_token and source_by_token[token] in allowed_sources]

    factual_claims = [claim for claim in claims if claim.get("factual", True)]
    supported_with_citation = 0
    unsupported_claims = 0
    uncited_claims = 0
    annotated_citations = 0
    supported_citations = 0
    incorrect_citations = 0
    partial_citations = 0
    insufficient_evidence_citations = 0
    unresolvable_claim_citations = 0
    for claim in factual_claims:
        label = claim.get("support_label")
        if label not in SUPPORT_LABELS:
            raise ValueError(f"claim {claim.get('claim_id')!r} needs a valid support_label")
        if label != "supported":
            unsupported_claims += 1
        citations = claim.get("citations", [])
        if not isinstance(citations, list):
            raise ValueError("claim citations must be an array")
        resolved_for_claim = 0
        supported_for_claim = False
        for citation in citations:
            if not isinstance(citation, dict):
                raise ValueError("claim citations must contain annotation objects")
            token = citation.get("token")
            source_id = citation.get("source_id")
            relation = citation.get("evidence_relation")
            if relation not in SUPPORT_LABELS:
                raise ValueError("each claim citation needs a valid evidence_relation")
            resolvable = isinstance(token, str) and source_by_token.get(token) == source_id and source_id in allowed_sources
            if not resolvable:
                unresolvable_claim_citations += 1
                continue
            resolved_for_claim += 1
            annotated_citations += 1
            if relation == "supported":
                supported_citations += 1
                supported_for_claim = True
            elif relation == "contradicted":
                incorrect_citations += 1
            elif relation == "partially_supported":
                partial_citations += 1
            else:
                insufficient_evidence_citations += 1
        if not resolved_for_claim:
            uncited_claims += 1
        if label == "supported" and supported_for_claim:
            supported_with_citation += 1

    factual_count = len(factual_claims)
    parsed_count = len(parsed_tokens)
    return {
        "task_id": row.get("task_id"),
        "variant": row.get("variant"),
        "citation_parse_rate": len(parsed_tokens) / len(all_brackets) if all_brackets else None,
        "citation_resolution_rate": len(resolved_tokens) / parsed_count if parsed_count else None,
        "claim_citation_support_rate": supported_with_citation / factual_count if factual_count else None,
        "resolved_citation_support_precision": supported_citations / annotated_citations if annotated_citations else None,
        "factual_claim_count": factual_count,
        "unsupported_factual_claim_count": unsupported_claims,
        "uncited_factual_claim_count": uncited_claims,
        "incorrect_citation_count": incorrect_citations,
        "partially_supported_citation_count": partial_citations,
        "insufficient_evidence_citation_count": insufficient_evidence_citations,
        "unresolvable_claim_citation_count": unresolvable_claim_citations,
        "citation_token_count": parsed_count,
        "resolved_citation_token_count": len(resolved_tokens),
        "latency_ms": row.get("latency_ms"),
        "usage": row.get("usage"),
    }


def aggregate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    rate_fields = (
        "citation_parse_rate", "citation_resolution_rate", "claim_citation_support_rate",
        "resolved_citation_support_precision",
    )
    output: dict[str, Any] = {"answer_count": len(rows)}
    for field in rate_fields:
        values = [row[field] for row in rows if isinstance(row.get(field), (int, float))]
        output[field] = sum(values) / len(values) if values else None
    for field in (
        "factual_claim_count", "unsupported_factual_claim_count", "uncited_factual_claim_count",
        "incorrect_citation_count", "unresolvable_claim_citation_count", "citation_token_count",
        "resolved_citation_token_count", "partially_supported_citation_count", "insufficient_evidence_citation_count",
    ):
        output[field] = sum(int(row.get(field, 0)) for row in rows)
    latencies = [row["latency_ms"] for row in rows if isinstance(row.get("latency_ms"), (int, float))]
    output["latency_ms_mean"] = sum(latencies) / len(latencies) if latencies else None
    input_tokens = [row["usage"].get("input_tokens") for row in rows if isinstance(row.get("usage"), dict) and isinstance(row["usage"].get("input_tokens"), int)]
    output_tokens = [row["usage"].get("output_tokens") for row in rows if isinstance(row.get("usage"), dict) and isinstance(row["usage"].get("output_tokens"), int)]
    output["input_tokens_reported_total"] = sum(input_tokens) if input_tokens else None
    output["output_tokens_reported_total"] = sum(output_tokens) if output_tokens else None
    output["usage_records"] = min(len(input_tokens), len(output_tokens))
    output["usage_missing_count"] = len(rows) - output["usage_records"]
    return output


def score_file(fixture: Path, answers: Path, output: Path) -> dict[str, Any]:
    tasks = read_jsonl(fixture)
    task_by_id = {str(task["task_id"]): task for task in tasks}
    input_rows = read_jsonl(answers)
    seen: set[tuple[str, str]] = set()
    scored: list[dict[str, Any]] = []
    pair_config: dict[str, tuple[Any, Any]] = {}
    common_config: tuple[Any, Any] | None = None
    for row in input_rows:
        task_id = str(row.get("task_id", ""))
        input_variant = str(row.get("variant", ""))
        variant = LEGACY_VARIANTS.get(input_variant, input_variant)
        if task_id not in task_by_id or variant not in VARIANTS:
            raise ValueError(f"unknown task/variant pair: {task_id!r}/{input_variant!r}")
        key = (task_id, variant)
        if key in seen:
            raise ValueError(f"duplicate answer row for {key}")
        seen.add(key)
        model = row.get("model")
        token_budget = row.get("token_budget")
        prior = pair_config.setdefault(variant, (model, token_budget))
        if prior != (model, token_budget):
            raise ValueError(f"variant {variant} has inconsistent model or token_budget")
        if common_config is None:
            common_config = (model, token_budget)
        elif common_config != (model, token_budget):
            raise ValueError("all variants must use the same model and token_budget")
        source_ids = {str(item["source_id"]) for item in task_by_id[task_id]["evidence"]}
        normalized_row = {**row, "variant": variant}
        if input_variant != variant:
            normalized_row["legacy_variant"] = input_variant
        scored.append(score_answer(normalized_row, source_ids))

    for task_id in task_by_id:
        if all((task_id, variant) in seen for variant in VARIANTS):
            for row in scored:
                if row["task_id"] == task_id:
                    row["paired_task_id"] = task_id

    by_variant: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in scored:
        by_variant[str(row["variant"])].append(row)
    summary = {
        "fixture_sha256": sha256_file(fixture),
        "answer_file_sha256": sha256_file(answers),
        "generated_answer_count": len(input_rows),
        "paired_task_count": sum(1 for task_id in task_by_id if all((task_id, variant) in seen for variant in VARIANTS)),
        "incomplete_task_count": sum(1 for task_id in task_by_id if not all((task_id, variant) in seen for variant in VARIANTS)),
        "model_and_budget": {variant: {"model": config[0], "token_budget": config[1]} for variant, config in pair_config.items()},
        "variants": {variant: aggregate(rows) for variant, rows in sorted(by_variant.items())},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"summary": summary, "per_answer": scored}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare", help="write fixed three-condition generation requests; does not call a model")
    prepare.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    prepare.add_argument("--out", type=Path, required=True)
    prepare.add_argument("--model", required=True)
    prepare.add_argument("--token-budget", type=int, required=True)
    score = sub.add_parser("score", help="score a human-annotated answer JSONL file")
    score.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    score.add_argument("--answers", type=Path, required=True)
    score.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            if args.token_budget < 1:
                raise ValueError("token budget must be positive")
            count = prepare_requests(args.fixture, args.out, args.model, args.token_budget)
            print(json.dumps({"request_count": count, "output": str(args.out), "model_called": False}))
        else:
            summary = score_file(args.fixture, args.answers, args.out)
            print(json.dumps(summary, ensure_ascii=False, indent=2))
    except (OSError, ValueError, KeyError) as error:
        print(f"answer evaluation error: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
