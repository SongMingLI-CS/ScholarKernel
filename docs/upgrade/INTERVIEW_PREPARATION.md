# ScholarKernel 面试准备

## 一分钟介绍

ScholarKernel 是一个面向学术研究流程的 AI Agent 原型。我负责把论文文档解析、带证据来源的检索、Agent 工作流和模型用量记录接入一个可恢复的 Web 应用。工程上，我实现了服务端 Job 的持久化检查点和恢复路径，并为文档 chunk 增加稳定来源 ID、页码映射和可选混合检索。研究上，我另建 Python/PyTorch 工程，在固定 SciFact 数据上比较 BM25、Dense、RRF 和 Cross-Encoder，再用 train split 微调一个小 reranker，通过本机 HTTP 接口验证 ScholarKernel 的集成路径。

这个实验只证明了单个英文 evidence retrieval dev 集上的排序表现，不代表用户文档或生成答案准确率；Agent 单/多智能体比较、独立 test、生产性能与真实 Provider API 都没有验证。主应用仍没有 OCR，浏览器执行与服务端持久化 Job 还未完全统一。

## 主要代码位置

| 主题 | 位置 | 讲解重点 |
|---|---|---|
| 工作流规划与执行 | `src/lib/agent/planner.ts`, `src/lib/agent-executor.ts` | 节点协议、依赖顺序、失败/取消/部分结果 |
| Job 与恢复 | `src/lib/agent-jobs.ts`, `src/app/api/agent/jobs/`, `scripts/agent-worker.ts` | 检查点、事件序号、租约、至少一次执行边界 |
| PDF 与分块 | `src/lib/document/pdf-parser.ts`, `academic-semantic-chunker.ts`, `column-reorder.ts` | PDF.js、坐标/栏顺序、页码未知策略 |
| 文档索引 | `src/lib/document/document-chunk-index.ts`, `search-conversation-chunks.ts` | 稳定 chunk ID、hash、BM25/Dense/RRF 和页码映射 |
| rerank 接口 | `src/lib/document/rerank-gateway.ts`, `embedding-gateway.ts` | 显式 opt-in 本地 HTTP、版本校验和失败降级 |
| Token 与错误处理 | `src/lib/agent/llm-utils.ts`, `src/lib/billing/` | 输出 Token 上限、AbortSignal、Provider usage、静态成本估算 |
| 独立检索实验 | `../ScholarKernel-reranker/src/{benchmark,train_reranker,service}.py` | 数据固定、训练/验证分离、请求协议、指标限制 |

## 需要亲自解释的实验细节

- SciFact 有 5,183 篇 evidence abstracts，使用官方 train/dev claim 切分；300 条 dev query 中 188 条有可用 evidence 标注。
- `SUPPORT` 与 `CONTRADICT` 都代表“被标注为该 claim 的证据”，检索指标不判断 claim 的真假。无标签 query 不按零分计入。
- train/dev 间检测到两组完全相同的规范化 claim 文本，最终训练排除了重复 train 行。负例为 BM25 头部未标注文档，可能仍含未标注相关性。
- 微调模型用 `BCEWithLogitsLoss`，一个 epoch、4 个 BM25 困难候选、batch 16、learning rate `2e-5`、最大 pair 长度 384，seed `20261030`。Dev 被用于 epoch 选择，因此结果不是独立 test。
- Hybrid+微调模型的 Recall@20/MRR@10/nDCG@10 是 `0.9883/0.8838/0.9050`；Hybrid+预训练为 `0.9803/0.8447/0.8675`。没有显著性检验，不能声称普遍提升。
- 10 条 query 的 top-3 来源抽样共 30 项，都能精确回查 SciFact title。SciFact 是摘要语料，没有可核实页码；因为没有生成回答，论断支持性与事实正确性没有测量。

## 追问及答题要点

### 为什么保留 BM25？

BM25 是可解释且不依赖模型服务的基线。Dense 服务是可选项，失败可降级；RRF 用排名融合而不是直接混合不同量纲的分数。是否更好用冻结数据集实测，不预设结果。

### 为什么训练 Cross-Encoder，而不是继续只用 Embedding？

Embedding 先做候选召回，Cross-Encoder 对 query-document pair 联合编码重排较小候选集。本实验在 top-50 池上排序，不改变池外召回；模型推理开销更高。训练只验证一个英文数据集，尚无跨域/中文结论。

### 是否这是原创模型或学术创新？

不是基础模型或 Embedding 的自主训练；是基于公开 Cross-Encoder 的小规模任务微调实验。现有结果没有独立 test、多个随机种子、统计检验或与相关论文严谨对照，不能宣称论文创新性。

### RAG 引用是否证明回答正确？

不证明。来源 ID 和可观测页码用于定位，检索指标只评价标注证据的排序。要验证答案论断，需要固定生成任务并由人工确认每条论断是否被对应原文支持；当前没有这组结果。

### 哪些能力还未完成？

Agent 单/多智能体受控评测、PDF OCR、独立检索测试集、生产 GPU 部署、中文评测、真实 Provider 用量与端到端成本都未完成；服务端 Job 也不覆盖所有旧浏览器执行路径。

## 展示边界

可以展示架构、状态机、可复现检索基线、一次真实本机模型训练、指标文件和本地服务集成。应把研究结果限定为 SciFact dev 排序结果；不要称系统已生产就绪、答案已经被证明可信、模型显著优于基线或成本已降低。
