# Acceptance evaluation fixtures

`citation-support-v1.jsonl` is a fixed 10-item answer-grounding task set. It is selected deterministically as the first 10 official SciFact dev claims with annotated evidence, sorted by claim ID. Six examples carry a SUPPORT label and four a CONTRADICT label. Each record stores the original claim, one annotated evidence abstract sentence range, its source ID, and `page_number: null` because SciFact abstracts do not provide PDF page locations.

The task set is for future controlled model evaluation. It contains no generated answer and is not an answer-quality result. It is intentionally small and sequentially selected, so it is not statistically representative. A released evaluation should add frozen tasks and human-reviewed answer annotations before comparison.

Attribution and terms: SciFact claims/evidence annotations are CC BY 4.0; the corpus abstracts are ODC-By 1.0, per the source research repository's `NOTICE.md`. Original data manifest and source archive hashes are in the local `ScholarKernel-reranker/data/manifest.json`. Preserve dataset attribution and license when redistributing these fixtures.
