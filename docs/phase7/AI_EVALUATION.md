# Phase 7 AI Evaluation 状态

## 本轮结论

本轮没有启动新模型评测。没有配置真实模型供应商 key，独立 reranker 工程与 checkpoint 未恢复。隔离 venv 中 PyTorch CUDA runtime 已验证可用，但缺少模型代码与权重，不能进行 reranker 推理。Phase 6 的 NFCorpus/SciFact 指标在此作为历史结果引用，不作为本轮复现实验或新模型效果。

## 继承的检索评测

仓库 [Phase 6 AI 结果](../phase6/AI_RESULTS.md) 报告使用 BEIR NFCorpus 官方 test：3,633 篇文献，test qrels 覆盖 323 个查询。SciFact train/dev 参与了 reranker 训练与 epoch 选择；NFCorpus test 没有用于调参或选 checkpoint。

报告记录的排序指标：

| 系统 | Recall@10 | Recall@20 | MRR@10 | nDCG@10 | 本机旧环境 p95 |
|---|---:|---:|---:|---:|---:|
| BM25 | 0.1491 | 0.1788 | 0.5151 | 0.4597 | 18.89 ms |
| Dense | 0.1550 | 0.1887 | 0.5077 | 0.4955 | 46.58 ms |
| Hybrid | 0.1615 | 0.2048 | 0.5462 | 0.5185 | 62.05 ms |
| Hybrid + pretrained reranker | 0.1665 | 0.1987 | 0.5795 | 0.5501 | 1,000.89 ms |
| Hybrid + fine-tuned reranker, 3 seeds mean | — | — | — | 0.5589 | 约 0.93–1.00 s / seed |

三 seed 平均 nDCG@10 相对预训练点差 +0.0088。Seed 20261030 和 20261031 的逐 seed query-bootstrap 区间包含 0；seed 20261032 区间高于 0。合并 seed 的 query bootstrap 95% 区间约 `[+0.0007,+0.0170]`，它只表示 query 抽样不确定性，不表示训练 seed 方差。

NFCorpus test 查询没有与 SciFact train/dev 的精确或高 Jaccard 重复；但文档审计发现 9 个归一化标题重合、5 个标题+正文哈希重合以及 7 个 SimHash 近重复候选，22 个 query 的 qrels 至少关联其中一个候选。旧报告额外给出去除 7 个候选后的 post-hoc 敏感性分析，去重后微调均值 0.5588、预训练 0.5499。它不是在完全无重叠新语料上重新检索。

旧 p95 来自本机 Apple MPS 离线评测，不能外推到当前 GPU、生产环境、中文或用户 PDF 延迟；本轮只新跑了 PostgreSQL 合成 BM25 基准，见 [TEST_RESULTS.md](TEST_RESULTS.md)。

## SciFact 边界

旧 [ML 研究记录](../upgrade/ML_RESEARCH.md) 使用 SciFact dev 选 epoch。报告列出 300 个 dev query（188 个可评分）；Hybrid + 微调模型 Recall@20 0.9883、MRR@10 0.8838、nDCG@10 0.9050，Hybrid + 预训练模型对应 0.9803、0.8447、0.8675。这些是开发集选择结果，不是独立测试成绩；不能将其宣传为未触碰的 test。

## 答案质量、引用和多 Agent

Phase 6 的 10 个 claim fixture 有 6 条 SUPPORT、4 条 CONTRADICT，但没有任何真实生成答案；20 条 Single-Agent/Multi-Agent 成对请求仍为 `pending_generation`。所以目前没有答案准确率、引用支持率、幻觉率或多 Agent 优势证据。Reviewer fixture 在 Phase 7 仅验证来源 URL 会传入模型提示、无来源时会阻止依赖文献的评审；fixture 文本不是效果数据。

Phase 7 另实现了三条件离线答案评测工具，固定 10 项任务为 Single-Agent、Multi-Agent without collaboration、Collaborative Multi-Agent 各准备 10 条请求。当前 30 条均为 pending_generation，模型为 pending-selection；没有真实生成答案，也没有人工 claim/evidence 标注。因此，前段 Phase 6 的 20 条历史配对请求和本轮新建的 30 条请求都不能作为已评分结果。脚本与结果细节见 [AI_VALIDATION.md](AI_VALIDATION.md)。

## 本设备状态

- 没有真实模型 API key，也没有真实模型请求。
- `ScholarKernel-reranker` 源码路径未找到，checkpoint 文件未恢复。
- Python 3.12.10 可用；隔离 venv 中 PyTorch `2.12.0+cu130` 报告 CUDA 可用并检测到单个 CUDA 设备（型号省略）。没有下载任何模型，也没有执行 reranker 推理。
- 没有训练或下载研究模型；没有新的 SciFact/NFCorpus 指标。PyTorch runtime 为本设备独立安装项，详见 [ML_RECOVERY.md](ML_RECOVERY.md)。

下一步若恢复研究 repo，先核查数据集 archive SHA、模型 revision、checkpoint SHA 与数据使用许可；再冻结独立 test 方案并复算逐 query 排名。Agent 单/多对照须有固定请求、token 预算、人工论断标注和明确付费预算。
