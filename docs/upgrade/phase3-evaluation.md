# Phase 3：AI 检索评测

## 范围与可复现数据

本阶段在独立 Python 研究工程 `../ScholarKernel-reranker` 中实现冻结数据集上的检索评测，不把评测依赖并入 Next.js 应用。

- 数据集：Allen Institute for AI 发布的 SciFact。固定 archive SHA-256 为 `11c621288d41ac144d29b13b0f8503b3820b7d6e8b1f6ff24dff335c196d76be`；S3 对象版本和逐文件哈希见研究工程的 `data/manifest.json`。
- 语料：5,183 篇英文科学文献摘要。查询采用官方 `claims_dev` 300 条，其中 188 条带有可用 evidence 标注，112 条无公开相关性标注。
- 训练与验证：检索基线只用 dev 查询；后续 reranker 训练只用官方 train 查询。train/dev 之间发现两组规范化 claim 文本完全重复，微调阶段将对应 train 行排除，避免相同查询泄漏。
- 相关性：官方 `SUPPORT` 和 `CONTRADICT` evidence 都表示该文档是 claim 的标注证据；指标不评估 claim 真伪。
- 许可：SciFact claims/evidence 与语料的许可和来源说明见研究工程 `NOTICE.md` 及官方许可链接。使用者仍需遵守各上游材料的归属与许可条件。

## 系统与指标

比较固定的五条检索路径：BM25、Dense、RRF Hybrid、Hybrid + pinned 预训练 Cross-Encoder、Hybrid + SciFact train 微调 Cross-Encoder。语料、查询、qrels 和候选深度相同。指标宏平均为 Recall@5/10/20、MRR@10、nDCG@10；无标签查询单独计数，不按零召回计入。

| 系统 | Recall@20 | MRR@10 | nDCG@10 |
|---|---:|---:|---:|
| BM25 | 0.9479 | 0.7852 | 0.8163 |
| Dense | 0.9516 | 0.7314 | 0.7743 |
| Hybrid（BM25 + Dense，RRF） | 0.9580 | 0.7896 | 0.8234 |
| Hybrid + 预训练 Cross-Encoder | 0.9803 | 0.8447 | 0.8675 |
| Hybrid + SciFact 微调 Cross-Encoder | 0.9883 | 0.8838 | 0.9050 |

完整逐查询排序、汇总 JSON、运行配置、设备、模型 revision 和 checkpoint hash 位于研究工程 `results/`。运行命令和代码版本见该项目 README；实验在 Apple Silicon MPS、Python 3.13.3、PyTorch 2.8.0 上运行，seed 为 `20261030`。

## 引用抽样核验

`reports/citation-audit-sample.csv` 固定抽取 10 个 query 的 top-3 排序，共 30 条结果。每条 `scifact:{doc_id}` 都能精确解析到冻结语料中的 title。SciFact 语料是摘要数据，没有可核实的原文页码，因此样本没有生成页码；没有自然语言答案，所以论断支持性和答案真实性均未评估。10 个样本中有 9 个 top-1 命中官方 evidence 标注；另一个 query 的标注 evidence 出现在 rank 2。该小样本仅用于人工核对来源 ID 和标注定位，不是整体引用准确率估计。

## 未完成项目与解释边界

- 本阶段没有完成 Single-Agent、独立 Multi-Agent 与协作 Multi-Agent 的受控对照。该实验需要固定任务集及可执行模型预算；当前任务边界禁止调用外部模型 API，且没有现成的固定 Agent 评测语料。因此不报告 Agent 完成率、Token、成本、质量或延迟对照。
- dev split 参与微调 epoch 选择，故这里是验证集结果，不是未触碰测试集结果；没有置信区间或显著性检验。
- SciFact 是英文 evidence abstract 检索，不代表中文、整篇论文、本地用户文档、生成答案忠实度或产品端质量。
- 本地测得的模型耗时受设备、冷启动、批处理和并发负载影响。Hybrid 耗时只计算 RRF 融合本身；不能与完整检索流水线延迟直接比较。
- 没有调用真实 LLM Provider，没有产生或报告真实 API Token、费用或生产服务延迟。

## 运行与许可

在研究工程目录执行：

```bash
python src/prepare_data.py
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
HF_HUB_OFFLINE=1 .venv/bin/python src/benchmark.py --systems bm25 dense hybrid hybrid-rerank
```

模型第一次下载时需要访问 pinned Hugging Face 上游；之后可离线运行。数据地址、SHA、文件清单及许可见 `data/manifest.json`、`NOTICE.md`。本次 GitHub CI 未触发。
