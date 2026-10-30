# AI 效果评测记录

## 已验证

冻结 SciFact 数据集上的英文 evidence retrieval 比较由 `ScholarKernel-reranker` 独立工程执行。数据哈希、拆分、检索配置、随机种子、模型版本、逐查询 JSONL 和指标均已保存。基线与微调 reranker 的宏平均 Recall@20 / MRR@10 / nDCG@10 分别为：

| 方法 | Recall@20 | MRR@10 | nDCG@10 |
|---|---:|---:|---:|
| BM25 | 0.9479 | 0.7852 | 0.8163 |
| Dense | 0.9516 | 0.7314 | 0.7743 |
| Hybrid RRF | 0.9580 | 0.7896 | 0.8234 |
| Hybrid + 预训练 Cross-Encoder | 0.9803 | 0.8447 | 0.8675 |
| Hybrid + 微调 Cross-Encoder | 0.9883 | 0.8838 | 0.9050 |

结果仅覆盖 SciFact dev 的 188 个有标注查询，300 条查询中的 112 条无标签查询单独报告。两种证据方向都作为检索相关性；不以该实验判断 claim 的真伪。

## 人工来源抽样

10 条查询各检查 top-3，共 30 条来源映射。30 条来源 ID 均可回查冻结语料标题。SciFact 只有 abstract 文本，页码保持未知。9/10 个 top-1 文档有官方 evidence 标注，另一条查询的标注证据排在第 2 位。因为没有生成答案，此抽样不衡量答案论断是否受证据支持，也不等同统计意义的 citation accuracy。

## 尚未完成

Single-Agent、Multi-Agent without collaboration、Collaborative Multi-Agent 三组评测未执行。当前没有合规的固定任务集和冻结 Agent API 调用预算，且本轮禁止外部模型 API；不能把普通功能测试、Mock Agent 测试或检索指标冒充 Agent 效果实验。

没有真实供应商用量或成本，未评估生成质量、答案忠实度、中文检索和生产延迟。dev 被用于 epoch 选择，未保留一个本轮未触碰的测试集结果；也没有统计显著性分析。

复现数据和方法请见 [Phase 3 评测说明](phase3-evaluation.md) 及同级目录的研究工程。
