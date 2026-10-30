from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from answer_eval import aggregate, prepare_requests, score_answer, score_file


class AnswerEvaluationTests(unittest.TestCase):
    def test_prepare_writes_paired_requests_without_answers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.jsonl"
            fixture.write_text(json.dumps({
                "task_id": "task-1", "claim": "A claim", "prompt": "Use evidence.",
                "evidence": [{"source_id": "source:1", "text": "Evidence text", "page_number": None}],
            }) + "\n", encoding="utf-8")
            output = root / "requests.jsonl"
            count = prepare_requests(fixture, output, "fixture-model", 1024)
            rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(count, 2)
        self.assertEqual({row["variant"] for row in rows}, {"single-agent", "multi-agent"})
        self.assertTrue(all(row["status"] == "pending_generation" for row in rows))
        self.assertTrue(all("answer" not in row for row in rows))
        self.assertTrue(all(row["sources"][0]["page_number"] is None for row in rows))

    def test_scores_resolution_and_manual_support_annotations(self) -> None:
        answer = {
            "task_id": "task-1", "variant": "single-agent", "answer": "Claim [1], extra [2].",
            "sources": [{"citation_token": "[1]", "source_id": "source:1"}],
            "claims": [{"claim_id": "c1", "text": "Claim", "factual": True, "support_label": "supported",
                        "citations": [{"token": "[1]", "source_id": "source:1", "evidence_relation": "supported"}]}],
            "latency_ms": 50, "usage": {"input_tokens": 12, "output_tokens": 4},
        }
        scored = score_answer(answer, {"source:1"})
        self.assertEqual(scored["citation_parse_rate"], 1.0)
        self.assertEqual(scored["citation_resolution_rate"], 0.5)
        self.assertEqual(scored["claim_citation_support_rate"], 1.0)
        self.assertEqual(scored["resolved_citation_support_precision"], 1.0)
        self.assertEqual(scored["unresolvable_claim_citation_count"], 0)
        summary = aggregate([scored])
        self.assertEqual(summary["input_tokens_reported_total"], 12)
        self.assertEqual(summary["output_tokens_reported_total"], 4)

    def test_score_file_requires_identical_paired_model_and_budget(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.jsonl"
            fixture.write_text(json.dumps({
                "task_id": "task-1", "claim": "A claim", "prompt": "Use evidence.",
                "evidence": [{"source_id": "source:1", "text": "Evidence text", "page_number": None}],
            }) + "\n", encoding="utf-8")
            answers = root / "answers.jsonl"
            rows = []
            for variant, model in (("single-agent", "model-a"), ("multi-agent", "model-b")):
                rows.append({
                    "task_id": "task-1", "variant": variant, "model": model, "token_budget": 1024,
                    "answer": "Claim [1].", "sources": [{"citation_token": "[1]", "source_id": "source:1"}],
                    "claims": [{"claim_id": "c1", "text": "Claim", "support_label": "supported",
                                "citations": [{"token": "[1]", "source_id": "source:1", "evidence_relation": "supported"}]}],
                })
            answers.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "same model and token_budget"):
                score_file(fixture, answers, root / "scores.json")

    def test_score_file_saves_paired_per_answer_and_summary_results(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "fixture.jsonl"
            fixture.write_text(json.dumps({
                "task_id": "task-1", "claim": "A claim", "prompt": "Use evidence.",
                "evidence": [{"source_id": "source:1", "text": "Evidence text", "page_number": None}],
            }) + "\n", encoding="utf-8")
            answers = root / "answers.jsonl"
            rows = []
            for variant in ("single-agent", "multi-agent"):
                rows.append({
                    "task_id": "task-1", "variant": variant, "model": "fixture-model", "token_budget": 1024,
                    "answer": "Claim [1].", "sources": [{"citation_token": "[1]", "source_id": "source:1"}],
                    "claims": [{"claim_id": "c1", "text": "Claim", "support_label": "supported",
                                "citations": [{"token": "[1]", "source_id": "source:1", "evidence_relation": "supported"}]}],
                    "latency_ms": 10, "usage": {"input_tokens": 3, "output_tokens": 2},
                })
            answers.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            output = root / "scores.json"
            summary = score_file(fixture, answers, output)
            saved = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(summary["paired_task_count"], 1)
        self.assertEqual(summary["generated_answer_count"], 2)
        self.assertEqual(set(saved["summary"]["variants"]), {"single-agent", "multi-agent"})
        self.assertEqual(len(saved["per_answer"]), 2)
        self.assertEqual(saved["summary"]["variants"]["single-agent"]["input_tokens_reported_total"], 3)


if __name__ == "__main__":
    unittest.main()
