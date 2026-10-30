# Phase 5.4：SciFact 微调与检索指标复核

## 检查范围与可复现状态

复核对象是独立本地 checkout `ScholarKernel-reranker`，没有修改该 checkout，没有推送或访问模型服务。SciFact 原始归档 SHA-256 与 `data/manifest.json` 一致；`corpus.jsonl`、`claims_train.jsonl`、`claims_dev.jsonl` 三个处理文件的 SHA-256 也全部匹配清单。Corpus 有 5,183 篇摘要，官方 `claims_train` 有 809 条，官方 `claims_dev` 有 300 条，claim ID 无交集。

本轮加入独立标准库复算工具：

```bash
python3 scripts/acceptance/recompute_scifact_evaluation.py /path/to/ScholarKernel-reranker
```

工具从各系统保存的 JSONL 重新计算宏平均 Recall@5/10/20、MRR@10、nDCG@10，逐 query 对比落盘 metric、对比 metrics.json，并复核数据/权重 hash、模型候选池及配对 bootstrap。运行命令为：

```bash
python3 scripts/acceptance/recompute_scifact_evaluation.py ../ScholarKernel-reranker
```

复算直接使用原始官方 dev claim/evidence 生成 qrels，并逐项核对预测中的 claim/qrels、query 完整性、排名去重和 corpus 文档 ID；五个系统均无缺失/重复 query、无重复排名文档、无未知文档、无 claim/qrel 不一致。五套排序的 300 条逐 query 指标没有不一致；五份 metrics.json 中五项聚合指标与复算值的绝对差全部为 0。训练报告标记 188 条有标注 query、112 条无标注 query；复算也得到同样数量。代码将 `SUPPORT` 和 `CONTRADICT` 标注文档都作为证据检索正例，对 188 条 eligible query 做宏平均；112 条无公开证据标注的 query 不作为零召回计分。该任务衡量证据文档排序，不是 claim 真伪分类或答案忠实度。

| 检索方法 | nDCG@10 | Recall@10 | MRR@10 |
|---|---:|---:|---:|
| BM25 | 0.816272 | 0.929521 | 0.785237 |
| Dense | 0.774275 | 0.911702 | 0.731372 |
| Hybrid RRF | 0.823426 | 0.938298 | 0.789566 |
| Hybrid + 预训练 Cross-Encoder | 0.867542 | 0.955142 | 0.844664 |
| Hybrid + SciFact 微调 Cross-Encoder | 0.904965 | 0.981915 | 0.883810 |

这几个数字均来自固定的官方 dev split。预训练与微调 reranker 对 300 个 query 使用完全相同的候选文档集合；候选集合也与 hybrid top-50 一致。它排除了候选池差异造成的直接排名对照偏差，但无法排除在同一 dev 集调参/选 epoch 造成的选择偏差。

## 训练过程、数据标签和权重

代码 `src/train_reranker.py` 从 pinned `cross-encoder/ms-marco-MiniLM-L6-v2` revision `c5ee24cb16019beea0893ab7796b1df96625c6b8` 初始化单输出分类器。它使用 AdamW、`BCEWithLogitsLoss` 和 query-document 二分类样本训练；配置记录为 seed `20261030`、MPS、PyTorch `2.8.0`、1 epoch、batch size 16、学习率 `2e-5`、最大长度 384。每个带标注 train query 的 BM25 负样本取未标注且非 cited 的摘要；当前训练摘要记载 505 个 query、564 个正样本对、2,020 个“未标注负例”对。它们不是已证实不相关的负例，可能含未标注证据。

训练代码断言 train/dev query ID 不重叠，并从训练集排除与 dev 完全重复的归一化 claim 文本；记录为排除 2 条。单独的字符 5-gram Jaccard 分析（小写英文字母/数字、空格归一化，排除完全相同文本）发现过滤后 train 与 dev 仍有 49 对相似度至少 0.8、7 对至少 0.9 的 query。高相似包括只改数字、基因亚型、比较方向或性别的临床 claim。这些并不能证明语义泄漏，也不能一概合并；但说明“只排除完全相同文本”不能作为独立泛化的充分证据，未来确认性评估应按近重复/研究主题审查或在训练前冻结额外测试集。

训练摘要只报告 1 个随机种子、1 个 epoch，且用 dev nDCG 选 best epoch。报告值 `best_dev_nDCG10_on_BM25_50_candidates = 0.884972` 是 BM25@50 条件下的训练期验证；上表 0.904965 是 Hybrid@50 候选下的最终微调重排结果，二者候选池不同，不能互换。SciFact 的 test split 在这些材料中没有可用 qrels；本轮没有将 dev 改名为 test，也没有重复训练或声称未见测试性能。

在相同 188 个 dev query 上对微调与预训练 reranker 的逐 query nDCG@10 差值做配对 bootstrap（10,000 次，seed `20261030`），均值差为 `+0.037423`，百分位 95% 区间为 `[+0.018368, +0.058415]`。由于报告指标参与了 epoch 选择，该区间是对这批 dev 数据的探索性统计，不是独立测试集推断，也没有校正多次研究决策。

当前本地 checkpoint 位于 sibling checkout 的 `models/checkpoints/scifact-reranker/`，被 `.gitignore` 排除且未被 Git 跟踪，SHA-256 `81e76d68e3a50f482ace7dceb72be2d21ef89909eb6933bcbeda0bdca7b104cb` 与训练摘要一致。没有把约 90 MB 权重加入主项目或上传。本轮使用 `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1` 在 CPU 本地加载该 checkpoint，并对单个合成 query-document pair 得到有限分数。**加载路径已实测；从头训练未重跑。**本机研究环境的 `torch==2.8.0`、`transformers==4.57.1` 已可用，requirements 锁定了这些版本和 tokenizers、safetensors、numpy。README 的推荐复现命令显式传 `--epochs 1`，与本轮训练摘要相符；脚本省略参数时默认 2 epochs，复现时应保留显式参数。

## 数据许可与结论边界

研究目录的 `NOTICE.md` 记录 SciFact claim/evidence 标注 CC BY 4.0、摘要语料 ODC-By 1.0，以及来源、归档版本和 hash；预训练模型应遵循各自模型卡/许可证。数据 hash 本轮已验证。训练没有重新下载数据、模型或调用外部 API。

可陈述的结果是：在当前固定 SciFact dev 评测与相同 Hybrid@50 候选池上，微调 Cross-Encoder 的保存排序得到更高的复算 nDCG@10/MRR@10；该结果具有局部配对统计支持，但存在 dev epoch 选择、近重复 query、单 seed、无独立 test 等限制。它不证明 ScholarKernel 用户 PDF 检索、中文检索、生成答案引用支持率、模型普遍泛化或 ScholarKernel 产品效果得到提升。

## 本阶段实际运行

- `python3 -m unittest discover -s ../ScholarKernel-reranker/tests -v`：5 项通过；标准库测试覆盖 BM25、qrels 计分、exact claim overlap 过滤和 RRF。
- `python3 scripts/acceptance/recompute_scifact_evaluation.py ../ScholarKernel-reranker`：5 个系统、1,500 条逐 query 记录复算；零逐条 metric mismatch；summary 差异为零；300/300 reranker 候选集合一致；输出 SHA 与清单匹配。
- `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1` 的本地 checkpoint 加载和一个合成 pair 前向：成功，分数有限。未访问网络。
- 未运行从头训练、全量 benchmark 重新推理、多随机种子实验或独立 test；没有用 dev 数据生成新的预测。
