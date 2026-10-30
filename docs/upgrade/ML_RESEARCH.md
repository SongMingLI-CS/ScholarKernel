# PyTorch Reranker 研究记录

## 工程位置与复现入口

独立工程：`../ScholarKernel-reranker`。主 ScholarKernel 仓库不包含训练运行时或模型权重。关键文件：

- `src/prepare_data.py`：核对 SciFact archive SHA，准备冻结 JSONL 和 manifest。
- `src/bm25.py`、`src/metrics.py`：BM25 与 Recall/MRR/nDCG 实现。
- `src/benchmark.py`：BM25、Dense、RRF、预训练 Cross-Encoder、微调 Cross-Encoder 统一入口，并保存逐 query 排序。
- `src/train_reranker.py`：按 query 分组构造 pair、训练和 dev 选择。
- `src/service.py`：本机 embedding/reranker HTTP adapter。
- `results/`：冻结的预测 JSONL、汇总指标和训练摘要。
- `NOTICE.md`：数据来源、上游许可证和模型卡说明。

复现开发集最终对照：

```bash
python src/prepare_data.py
python -m unittest discover -s tests -v
python src/train_reranker.py --epochs 1
HF_HUB_OFFLINE=1 python src/benchmark.py --include-finetuned --output-dir results/reproduction
```

首次下载模型需要网络访问官方 Hugging Face 仓库；权重在本地缓存后可离线训练/评测。研究工程实际使用参数、revision、seed 和 checkpoint hash 保存于 JSON。该命令会写入新的 `results/reproduction`，不会替代已记录结果。

## 研究问题与训练

探索问题：在 SciFact 标注证据检索中，用 train split 的四个 BM25 困难候选负例微调小型 Cross-Encoder，是否改善 BM25+Dense RRF 候选上的排序？这只是单数据集工程假设，不是已确立创新点。

最终模型基于 `cross-encoder/ms-marco-MiniLM-L6-v2` pinned revision。1 epoch 二分类训练使用 505 个有证据 train query group、564 个正 pair 和 2,020 个未标注候选负例。先检测并排除两条与 dev 文本完全重复的 train claims。优化器/学习率/批次等配置及训练 loss 见 `results/training/training-summary.json`。模型选择使用 dev nDCG@10，因此没有未触碰测试集指标。

## 已观测结果

SciFact dev（300 个 query，其中 188 个可评分）上，Hybrid+微调 reranker 的 Recall@20 为 0.9883、MRR@10 为 0.8838、nDCG@10 为 0.9050；Hybrid+预训练 reranker 分别为 0.9803、0.8447、0.8675。原始 query 级结果在 `results/phase3-finetuned/`。

这些值来自公开英文 abstract corpus 的标注 evidence 检索；未评估 query 的答案生成、论断事实性、中文、整篇论文或 ScholarKernel 用户上传文档。无标签 query 被单列；BM25 “未标注候选负例”可能实际上仍有未标注相关性。

## 部署说明

训练 checkpoint 不纳入 Git，SHA-256 `81e76d68e3a50f482ace7dceb72be2d21ef89909eb6933bcbeda0bdca7b104cb` 作为版本标识。Python adapter 默认只绑定 `127.0.0.1`，请求与响应携带模型名和 revision。ScholarKernel 只有在显式设置 `LOCAL_EMBEDDING_API_URL` / `LOCAL_RERANKER_API_URL` 时才使用这些本地服务；服务不可用由应用既有逻辑降级到 lexical retrieval。

本轮实测了应用 → 本地 MPS 服务的 HTTP 路径和 isolated PostgreSQL 文档路由集成；没有容器化、跨机器、生产 GPU、进程守护、负载和 SLA 测试。权重需单独下载或训练，不能只凭代码 clone 后立即推理。

## 后续可以验证的问题

1. 多随机种子、bootstrap 置信区间以及独立 test split 是否仍有稳定差异。
2. 不同负例策略和候选深度对召回与排序的影响。
3. CPU、MPS、CUDA 下完整冷启动和每 query 延迟/吞吐的权衡。
4. 在有许可的中文/多学科 corpus 上评测中英跨语言与引用定位。
5. 对应 ScholarKernel 本地文档的受控人工标注评估；在执行前先定义数据授权和离线方案。

目前没有证据支持宣称论文创新性、统计显著性、模型准确率提升百分比或生产成本收益。
