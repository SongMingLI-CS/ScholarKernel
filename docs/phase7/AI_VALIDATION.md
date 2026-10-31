# Phase 7 AI 效果验收状态

日期：2026-10-31

## 本轮实际完成

实现了可离线准备和评分的三条件答案评测工具，代码位于 scripts/acceptance/answer_eval.py。固定条件为 Single-Agent、Multi-Agent without collaboration、Collaborative Multi-Agent。10 条固定任务生成 30 行待生成请求，每个条件 10 行；任务集 SHA-256 为 f44feeef6b1d84acf719247ed6d9576be85fe67559865ec099aa2f641153a8d2。

生成准备产物当前检查为 30/30 pending_generation，模型字段 pending-selection，token budget 4096；没有答案文本、模型输出或真实 usage。prepare 子命令显式不调用模型。相同任务三条件要求一致模型和 token budget；评分输入可保存答案、来源、逐 claim 的引用 token / source ID / evidence relation 人工标注、延迟及 usage。工具汇总 citation parse/resolution、claim-citation support、延迟和实际记录到的 token usage。

## 实际执行证据

    python scripts/acceptance/answer_eval.py prepare --out ..\answer-eval-final-check\requests.jsonl --model pending-selection --token-budget 4096
    {"request_count": 30, "output": "..\\answer-eval-final-check\\requests.jsonl", "model_called": false}
    本地检查：30 行 pending_generation；taskset SHA-256 f44feeef6b1d84acf719247ed6d9576be85fe67559865ec099aa2f641153a8d2
    请求 JSONL SHA-256 9b3923d1236a40d30f75ad7b129a0424d8e6ba0ada7af849671d438435de531a

    python scripts/acceptance/test_answer_eval.py -v
    Ran 5 tests — OK
    python -m compileall -q scripts/acceptance
    exit code 0

固定 fixture：docs/acceptance/fixtures/citation-support-v1.jsonl；SHA-256：f44feeef6b1d84acf719247ed6d9576be85fe67559865ec099aa2f641153a8d2。10 项源于 SciFact dev 的固定 claim/evidence 样例，并非答案生成结果或统计代表性测试集。

单测覆盖三条件请求准备、人工支持关系评分、同条件配对、模型与预算一致性、结果保存、旧 multi-agent 名称兼容以及不完整配对标记。CI 中的 python-evaluation job 只运行该离线测试和语法检查；见 .github/workflows/ci.yml:156-172。

## 当前没有 AI 效果结论

没有真实模型 API key 或经批准的调用预算，本轮没有请求付费供应商，也没有使用本地真实模型生成答案。因此：

- Citation Support Rate、答案事实准确率、幻觉率：未计算。
- Single-Agent 与两类 Multi-Agent 的任务成功率、质量差值：未计算。
- 生成时延、成本与 token 消耗：没有真实调用记录，未计算。
- Reranker 推理与训练效果：未执行；研究工程和 checkpoint 未恢复，见 ML_RECOVERY.md。
- BM25 本轮测量只代表合成 PostgreSQL 数据的本地检索，不是答案质量或 Reranker 指标。
- Phase 6 SciFact / NFCorpus 数值仅作为历史排序评测引用，不是本轮复现，也不能替代答案层指标。

## 指标解释

| 层次 | 需要的证据 | 当前状态 |
|---|---|---|
| 检索质量 | 固定 corpus/query/qrels 的 Recall、MRR、nDCG | Phase 6 有历史 artifact；Phase 7 未复算 |
| 重排质量 | 同候选集下的排序对照与 checkpoint | 本轮缺少代码和权重，未测 |
| 引用解析 | 输出标记能否解析并映射到实际 source ID | 评分器与 fixture 单测通过；没有真实输出样本 |
| 引用证据支持 | 人工 claim 拆分和证据关系标注 | 评分字段已建；30 个请求尚无生成或标注 |
| 答案事实正确性 | 独立事实标注及错误分析 | 未评 |
| Agent 协作收益 | 固定任务/模型/检索/预算的成对三条件结果 | 请求可准备；尚无结果 |

## 复现入口与来源

固定输入和说明：docs/acceptance/fixtures/citation-support-v1.jsonl、docs/acceptance/fixtures/README.md。

请求准备入口：scripts/acceptance/answer_eval.py 的 prepare_requests / main；评分入口：score_answer / aggregate / score_file。回归测试：scripts/acceptance/test_answer_eval.py。

已有运行结果和 SciFact/NFCorpus 方法边界见 docs/phase7/AI_EVALUATION.md、docs/phase6/AI_RESULTS.md。不要把 fixture 单测、mock E2E、排序指标或合成 BM25 时间说成生成答案效果。
