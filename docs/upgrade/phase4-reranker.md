# Phase 4：独立 PyTorch Reranker 研究

## 项目边界

研究工程位于主仓库同级目录 `../ScholarKernel-reranker`，是独立 Git 仓库，不是主仓库子模块。模型训练、评测和 Python HTTP adapter 均与 Next.js 业务运行时分开。Git 中保存训练脚本、锁定版本、SciFact 数据及 hash、逐查询预测和训练摘要；不保存 Hugging Face 权重缓存、训练 checkpoint 或 Python venv。训练 checkpoint SHA-256：`81e76d68e3a50f482ace7dceb72be2d21ef89909eb6933bcbeda0bdca7b104cb`。

## 训练设置

- 初始化模型：`cross-encoder/ms-marco-MiniLM-L6-v2`，Hugging Face revision `c5ee24cb16019beea0893ab7796b1df96625c6b8`。
- 训练：SciFact 官方 train claims；同 dev 精确重复的 2 条 train claim 文本排除；505 个带证据 query group、564 个正样本 pair、2,020 个 BM25 未标注候选负例；随机种子 `20261030`。
- 目标：单段文本二分类 Cross-Encoder，以 `BCEWithLogitsLoss` 训练。每个正例 query 从前 100 BM25 候选中选 4 个未标注、非已引用文档为候选负例。未标注不保证不相关，存在 false-negative 风险。
- 参数：1 epoch、batch size 16、learning rate `2e-5`、最大 pair 长度 384；Apple Silicon MPS、Python 3.13.3、PyTorch 2.8.0。
- 选择：只对 BM25 top-50 候选排序，在 dev 上按 nDCG@10 选 epoch。dev 同时用于模型选择与报告，因此结果不是独立测试集结果。

最初发现 train/dev 里存在两组精确相同的规范化 claim 文本；未使用存在泄漏风险的中间 checkpoint 或指标作为结果。剔除 train 重复 query 后重新训练和跑完整对照。最终训练 loss 为 `0.3604644625`；BM25 top-50 条件下 dev nDCG@10 为 `0.8849716`。

## 完整检索对照

同一 SciFact dev 查询和语料上的指标：

| 方法 | Recall@5 | Recall@10 | Recall@20 | MRR@10 | nDCG@10 |
|---|---:|---:|---:|---:|---:|
| BM25 | 0.8728 | 0.9295 | 0.9479 | 0.7852 | 0.8163 |
| Dense | 0.8685 | 0.9117 | 0.9516 | 0.7314 | 0.7743 |
| Hybrid RRF | 0.9035 | 0.9383 | 0.9580 | 0.7896 | 0.8234 |
| Hybrid + pinned 预训练 Cross-Encoder | 0.9262 | 0.9551 | 0.9803 | 0.8447 | 0.8675 |
| Hybrid + SciFact 微调 Cross-Encoder | 0.9408 | 0.9819 | 0.9883 | 0.8838 | 0.9050 |

这是单个英文公开 benchmark 的 dev 集结果。BM25 候选召回、qrels 完整性、标签偏差、单一随机种子和 dev 选型会影响结果；没有 test split、bootstrap 置信区间或显著性检验。不能把结果解释成生成答案更可信或 ScholarKernel 用户文档效果提升。

## 服务和应用接入

`src/service.py` 提供 `127.0.0.1:8999` 的本机服务，支持应用契约 `POST /v1/embeddings` 与 `POST /v1/rerank`。服务按模型 ID/revision 校验输入，返回 embedding 维度、向量或原始候选 index/分数；批大小受限，embedding L2 归一化。默认不开放网络监听，不记录 query 或文档正文。模型权重需从 Hugging Face 官方仓库按固定 revision 下载；本次服务和端到端调用使用 `HF_HUB_OFFLINE=1`。

ScholarKernel 通过显式配置的本地 URL 调用服务。实际验证包括：

- `/health` 返回 MPS 状态。
- `/v1/embeddings` 返回 384 维、带 pinned revision 的真实模型向量。
- `/v1/rerank` 返回所训练 checkpoint 的 revision 和分数；合成样本中相关候选分数高于无关候选。
- 用本机服务配置运行 `document-index.integration.test.ts`：3 项通过，覆盖合成文档保存、真实本地 embedding/reranker 接入路径、稳定来源/页码、编辑替换和旧文档惰性索引。第三项协议断言仍使用确定性 HTTP mock。

此结果只验证模型服务协议与本机应用接线，不证明生产部署稳定性或用户文档效果。权重未提交，研究目录需先执行训练或下载 checkpoint，再设置 `RERANKER_CHECKPOINT_PATH`、`RERANKER_MODEL_ID`、`RERANKER_REVISION` 并启动服务。

## 运行记录与未验证项

- Python 单测：5 项通过；数据 archive 和处理文件 hash 验证通过；`compileall` 通过。
- 研究工程使用 Python 3.13.3、PyTorch 2.8.0、Transformers 4.57.1、tokenizers 0.22.1、MPS。`requirements.txt` 固定版本。
- 没有 CUDA GPU，也没有在消费级 NVIDIA GPU 上测过；CPU fallback 代码可选设备但本次未做独立 CPU 性能验证。
- GitHub Actions workflow 已添加但未触发。SciFact test split、其他学科/中文数据集、真实用户文档和供应商 API 均未验证。
- 未执行多 seed、超参消融、困难负样本对照、置信区间或外部论文创新性评估。当前结果是可复现工程实验，不代表已确认学术创新。
- 预训练与微调 reranker 的本机计时不作性能比较；所有结果均无真实服务 P95 SLA 或账单数据。
