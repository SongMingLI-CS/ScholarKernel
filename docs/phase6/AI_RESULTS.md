# ScholarKernel Phase 6 AI 评测结果

评测日期：2026-10-31。所有检索模型从本地缓存离线加载；未调用外部模型 API。结果只说明固定公开数据与本机环境上的检索表现，不等于 ScholarKernel 用户 PDF 的问答质量。

## 状态摘要

| 项目 | 状态 | 说明 |
|---|---|---|
| NFCorpus 官方 test 检索对比 | **真实验证通过（本地固定模型）** | 3,633 篇语料，323 个官方 test 查询；结果及 2,261 条逐查询排序保存在 artifacts。 |
| 查询重叠检查 | **真实验证通过** | NFCorpus test 与 SciFact train/dev 无精确相同 query，词项 Jaccard ≥0.65 的近重复数为 0。 |
| 语料重叠检查 | **检测到重叠并做敏感性分析** | 发现精确标题/文本和 SimHash 候选重叠；完整 test 数字照常保留，另提供去重敏感性结果。 |
| 多随机种子 reranker | **真实验证通过（3 个训练 seed）** | seed `20261030/31/32`，使用同一模型初始化、训练数据与配置；没有在 NFCorpus 调参或选 epoch。 |
| Single-Agent / Multi-Agent 答案质量 | **尚未验证** | 已准备公平成对请求和人工标注评分器；请求仍为 pending，没有生成答案。 |

## 独立检索评测设置

选用 BEIR 的 NFCorpus 官方 test split，而不是将 SciFact dev 重新命名为 test。官方压缩包 MD5 `a89dba18a62ef92f7d323ec890a0d38d`，SHA-256 `efe5be03f8c5b86a5870102d0599d227c8c6e2484328e68c6522560385671b0b`。数据包含 3,633 篇文献、3,237 个 query，test qrels 覆盖 323 个 query。数据出处：[BEIR 数据集列表](https://github.com/beir-cellar/beir/wiki/Datasets-available)、[BEIR 官方代码库](https://github.com/beir-cellar/beir)。原始数据保存在本地评测目录，未复制进 ScholarKernel 仓库。

查询重叠比较针对已有 SciFact train 和 dev claim，使用小写英文字母/数字 token 集的 Jaccard。323 条 NFCorpus test query 中，精确归一化重复 `0` 条，Jaccard ≥0.65 `0` 条，最高为 `0.3077`。这是规则化近似检测，不是语义等价判定；NFCorpus 与 SciFact 的主题及 query 写法也有数据集差异。

**语料存在交集。**与已有 SciFact 语料比较，发现 9 个唯一归一化标题重合、5 个唯一归一化标题加正文哈希重合（其中存在重复文档记录），SimHash Hamming 距离 ≤3 的候选共 7 条。它们是候选近重复，不都等于人工确认重复。22 个 test query 的 qrels 至少包含一个此类候选文档。因此将 NFCorpus 称为“独立 query/test split，已检测到部分语料重叠”，不声称是完全无污染的语料测试。

为了量化已知交集影响，新增 post-hoc 敏感性分析：从已保存排名及 qrels 中移除这 7 个候选文档，保留仍有其他已标注相关文献的 query；323 个 query 均仍有剩余 qrels。该步骤不重新运行全库检索、不补齐被删除的 Top‑K 文档，是对已保存排名的敏感性检查，不能替代完整的无重叠新语料实验。过滤前后的排序结论接近，详细数值见 [敏感性指标](artifacts/nfcorpus/overlap-filtered-metrics.json)。

## 模型与公平对照

- **BM25**：research checkout 的固定 BM25 实现。
- **Dense**：`sentence-transformers/all-MiniLM-L6-v2`，revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`，精确向量排序。
- **Hybrid**：BM25@100 与 Dense@100 用 RRF 合并至 100。
- **预训练 reranker**：`cross-encoder/ms-marco-MiniLM-L6-v2`，revision `c5ee24cb16019beea0893ab7796b1df96625c6b8`。
- **微调 reranker**：同一预训练初始化与 SciFact 训练流程，checkpoint seed `20261030`、`20261031`、`20261032`。

每个 test query 的 Hybrid Top‑50 作为全部预训练/微调 reranker 的完全相同候选池。逐查询文件检查后，三个微调 checkpoint 与预训练模型的候选 ID 在 `323/323` 条 query 上完全一致。BM25、Dense 和 Hybrid 指标也单独保留，用于衡量召回与重排条件差异。

微调配置：SciFact 官方 train/dev，训练 1 epoch、最大长度 384、batch size 16、learning rate `2e-5`、每个 query 4 个 BM25 未标注文献负例、MPS、PyTorch 2.8.0。训练集使用 505 个 query、564 个正例对及 2,020 个未标注负例对；未标注负例可能含未标注证据。dev 用于选 epoch。seed 31、32 的本轮训练摘要分别记录在 phase6 临时工作目录；三个 checkpoint SHA-256 均按训练程序的逐文件相对路径加文件内容算法计算：

| 训练 seed | checkpoint SHA-256 | 训练和选择边界 |
|---|---|---|
| `20261030` | `81e76d68e3a50f482ace7dceb72be2d21ef89909eb6933bcbeda0bdca7b104cb` | Phase 5 已有 checkpoint；SciFact dev 用于 epoch 选择。 |
| `20261031` | `42a53015938782f16b89fdce130090c422d2c1755fcaf2c78fba1edfaa72d3c0` | 本轮同配置训练；SciFact dev 仅用于选 epoch。 |
| `20261032` | `24f40f60e8bcae708741b441efbbf9fdc61bdee1f7be0cb25fd0fffdf805cca7` | 本轮同配置训练；SciFact dev 仅用于选 epoch。 |

## NFCorpus test 检索结果

所有指标在 323 个 test query 上宏平均。Recall 使用官方 qrels；延迟是当前本机 MPS 评测过程记录，包含对应检索阶段，不应外推至生产硬件或并发服务。

| 系统 | Recall@10 | Recall@20 | MRR@10 | nDCG@10 | 延迟 p95（ms） |
|---|---:|---:|---:|---:|---:|
| BM25 | 0.1491 | 0.1788 | 0.5151 | 0.4597 | 18.89 |
| Dense | 0.1550 | 0.1887 | 0.5077 | 0.4955 | 46.58 |
| Hybrid | 0.1615 | 0.2048 | 0.5462 | 0.5185 | 62.05 |
| Hybrid + pretrained reranker | 0.1665 | 0.1987 | 0.5795 | 0.5501 | 1,000.89 |
| Hybrid + fine-tuned seed 20261030 | 0.1672 | 0.2013 | 0.5780 | 0.5580 | 929.99 |
| Hybrid + fine-tuned seed 20261031 | 0.1683 | 0.2016 | 0.5787 | 0.5568 | 974.22 |
| Hybrid + fine-tuned seed 20261032 | 0.1693 | 0.2018 | 0.5827 | 0.5619 | 960.19 |

三次训练 checkpoint 的逐 query nDCG@10 算术平均为 `0.5589`，预训练 reranker 为 `0.5501`；差值 `+0.0088`。将每个 query 上三个 checkpoint 的 nDCG 平均后做配对 query bootstrap（2,000 次，三个 bootstrap RNG seed），95% 区间约为 `[+0.0007, +0.0170]`。这描述 query 抽样不确定性，不是训练 seed 方差区间。逐 seed 对预训练 reranker 的差值为：

| 微调 seed | nDCG@10 差值 | 配对 query bootstrap 95% 区间 | 解读 |
|---|---:|---:|---|
| `20261030` | +0.0078 | [−0.0012, +0.0163] | 区间包含 0。 |
| `20261031` | +0.0067 | [−0.0024, +0.0153] | 区间包含 0。 |
| `20261032` | +0.0118 | [+0.0038, +0.0202] | 本 checkpoint 的 query bootstrap 区间高于 0。 |

配对区间使用相同 323 条 query、每组 2,000 次 bootstrap，bootstrap RNG seed 为 `20261031/32/33`。每个比较方向的完整区间和每条 query 的 nDCG 位于 [metrics.json](artifacts/nfcorpus/metrics.json)。敏感性分析移除近重复文档后，三个 seed 的平均 nDCG@10 为 `0.5588`，预训练 reranker 为 `0.5499`，差值 `+0.0089`；配对区间约为 `[+0.0007, +0.0172]`。这个敏感性区间仍是 query bootstrap，不覆盖模型训练随机性或未检测出的重复。

这些结果支持“在这一 NFCorpus 测试中，Hybrid reranker 排序指标高于 BM25/Hybrid；三个微调 checkpoint 的 nDCG 点估计高于预训练模型”。它们不证明多 Agent 答案更准确，也不能代表中文 query、用户 PDF、其他学科、生产延迟或普遍检索质量。reranker 系统每条 query 的本机 p95 全流程延迟约 `0.93–1.00 s`，包括 BM25、Dense、RRF 和 reranker，未包含一次性索引构建；Dense 向量建库约 `35.5 s`。本机单次离线流程没有并发负载测试。

逐查询预测、每个系统失败案例（Top‑20 无相关文献）及哈希/模型参数见 [NFCorpus artifacts](artifacts/nfcorpus/)。累计记录 558 条 system-query 失败案例。前述公开数据许可和外部语料差异限制了结论；模型预训练来源与 NFCorpus 训练曝光无法完全核验。

## 答案生成和引用支持评测

已有任务集 [citation-support-v1.jsonl](../acceptance/fixtures/citation-support-v1.jsonl) 含 10 个 SciFact claim/evidence 输入，6 条 SUPPORT、4 条 CONTRADICT；摘要数据没有 PDF 页码，来源页码保留为 `null`。它是基于 SciFact dev 的答案评测 fixture，不能用来替代独立检索 test，也没有模型答案。

新增 [answer_eval.py](../../scripts/acceptance/answer_eval.py) 可准备同任务成对 Single-Agent / Multi-Agent 请求，并对真实回答及人工原子论断标注计分；[test_answer_eval.py](../../scripts/acceptance/test_answer_eval.py) 的 4 项流程测试通过。成对请求 artifact 有 20 行，两个变体统一标为 `model: pending-selection` 和 `token_budget: 4096`，状态为 `pending_generation`，不包含答案，也未调用模型。

评测器会分别保存引用解析率、引用来源解析率、带正确来源支持的原子论断比例、可解析引用支持精度、无引用事实论断、无依据论断、部分支持/矛盾/证据不足、真实供应商 usage 与延迟。回答事实拆分和 evidence relation 需要人工标注；来源支持和引用可解析性分开统计。

**答案效果状态：尚未验证。** 当前没有生成回答、引用支持率、幻觉率或 Single/Multi 差异，也没有模型凭据及调用预算。禁止将 fixture 标签、单测合成答案或 RAG 排序指标包装成生成效果结果。执行准备命令示例：

```bash
python3 scripts/acceptance/answer_eval.py prepare \
  --out docs/phase6/artifacts/answer-eval-requests.jsonl \
  --model pending-selection --token-budget 4096
```

有实际模型结果并完成原子论断人工标注后，使用 `answer_eval.py score --answers <annotated-answers.jsonl> --out <scores.json>` 生成分项结果；真实模型 token 用量必须来自实际调用记录，不可按字符推算。

## 产物与限制

- `artifacts/nfcorpus/metrics.json`：数据哈希、模型 revision、全 test 指标、配对区间、重叠审计和失败案例数。
- `artifacts/nfcorpus/{bm25,dense,hybrid,hybrid-rerank-*.jsonl}`：每个系统 323 条 query 的候选排名、分数、qrels、逐 query 指标及延迟。
- `artifacts/nfcorpus/failure-cases.jsonl`：各系统 Top‑20 没有相关文献的逐 query 记录。
- `artifacts/nfcorpus/overlap-filtered-metrics.json` 与对应 JSONL：移除已发现的 7 条近重复文献后的敏感性结果。
- `artifacts/answer-eval-requests.jsonl`：未执行生成的 20 条成对请求。
- NFCorpus 下载、处理数据、训练模型缓存及临时 seed 工作副本未加入 Git。
