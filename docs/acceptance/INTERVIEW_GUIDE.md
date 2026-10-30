# ScholarKernel AI/LLM 实习面试讲解指南

## 一分钟项目介绍

ScholarKernel 是一个面向学术研究场景的 AI Agent 工程原型。用户从 Web 输入研究任务后，Planner 生成有节点类型和依赖关系的工作流，Executor 调用搜索、文档读取、推理和同行评审工具。长文档通过 PDF.js 提取、栏顺序处理、学术章节切块和稳定来源编号进入 RAG；服务端 durable 路径将 Job、事件、检查点和用量写入 PostgreSQL，并由独立 Worker 执行。检索主路径是 BM25，可显式接本地 Dense embedding、RRF 和 reranker。

项目还有独立的 PyTorch/SciFact 检索研究代码。保存的 SciFact dev 结果可以从逐 query 排序重新算出，微调 reranker 在当前 dev 上的 nDCG@10 为 0.904965，预训练 reranker 为 0.867542；但 dev 参与 epoch 选择，train/dev 还有高字面近似，且没有独立测试集。这个数字只代表当前英文证据文档排序实验，不代表生成答案准确率或用户 PDF 效果。面试时应该把限制与工程验证一起讲清楚。

## 架构讲解顺序与代码位置

| 环节 | 主要代码 | 需要说明的技术点 |
|---|---|---|
| Chat UI / 执行模式 | `src/components/chat-panel.tsx`、`src/hooks/use-chat-send.ts` | 浏览器路径与服务端 durable Jobs 尚未完全统一；解释 server/local execution 配置。 |
| Planner / DAG / 状态 | `src/lib/agent/planner.ts`、`src/lib/agent-executor.ts` | 节点 schema、依赖执行、失败传播、partial/error/cancelled 与结果聚合。 |
| Job / Worker | `src/lib/agent/durable-jobs.ts`、`src/lib/agent-jobs.ts`、`scripts/agent-worker.ts` | PostgreSQL lease、event sequence、checkpoint、至少一次恢复语义。 |
| Job HTTP / SSE | `src/app/api/agent/jobs/route.ts`、`src/app/api/agent/jobs/[id]/events/route.ts`、`src/app/api/agent/jobs/[id]/resume/route.ts` | 创建、观察、续读和恢复入口的边界。 |
| PDF 文本与生命周期 | `src/lib/document/pdf-text-extract.ts`、`src/lib/document/layout-aware-parser.ts` | PDF.js 文本项、15 秒 deadline、8 MiB 限制、资源释放；无 OCR。 |
| 栏排序与章节分块 | `src/lib/document/column-reorder.ts`、`src/lib/document/academic-semantic-chunker.ts`、`src/lib/document/document-chunk-index.ts` | 坐标顺序、section、稳定 ID/hash、实际 page mapping。 |
| 全语料检索 | `src/lib/document/search-conversation-chunks.ts`、`src/lib/document/rerank-gateway.ts` | 256 行 keyset 页、两遍 BM25、Dense top-28、RRF、reranker 降级和线性延迟。 |
| 来源与引用 ID | `src/lib/tools/academic-search-strategy.ts` | URL 规整、去重、跨批次 citation ID 对齐；不补造不存在的页码。 |
| Token / usage | `src/lib/agent/llm-utils.ts`、`src/lib/billing/token-audit.ts`、`src/lib/billing/token-usage-bridge.ts` | output token cap、character context cap、真实 usage 与静态费率估算区别。 |
| 数据库结构 | `prisma/schema.prisma`、`prisma/migrations/` | schema 是模型目标，migrations 是部署执行历史；空库与重复部署证据。 |
| Research repo | sibling `ScholarKernel-reranker/src/benchmark.py`、`train_reranker.py`、`metrics.py` | 固定 SciFact、分类式 Cross-Encoder 微调、候选池和指标定义。主仓复算脚本：`scripts/acceptance/recompute_scifact_evaluation.py`。 |

## 常见追问

### 为什么不是直接对完整文献一次性排序？

旧实现固定最多读取 1,000 chunks，会漏掉较晚的证据。现在用 256 行 keyset 分页遍历，第一遍收集 query term 的全语料 BM25 document frequency 和平均长度，第二遍使用完整统计对每页评分。候选集合和中间内存有界，但数据库行仍扫描两次，因此性能为线性增长；本机只测了 5,000 合成 chunks。

### Dense 和 Cross-Encoder 各自做什么？

Dense embedding 以 query-document 向量余弦相似度补充词项召回；BM25 和 Dense 的排序用 Reciprocal Rank Fusion 合并。Cross-Encoder 对有限的候选段落与 query 联合打分，不能代替第一阶段宽召回。应用中的模型服务 opt-in；失败可回退。排序指标不能证明答案支持性。

### 为什么不给引用页码默认值？

检索引用应指向实际原文位置。PDF parser 能提供有效映射时记录页码；从旧纯文本、SciFact abstract 或不完整布局无法确定页码时存 `null`。用第一页填充会使引用看似可定位但证据错误。

### Agent Worker 崩溃后是否保证只执行一次？

不保证。Job lease 和已提交 checkpoint 支持重领与跳过已完成节点，但模型调用与数据库 checkpoint 是两个系统；如果模型已完成、checkpoint 尚未提交时进程中断，后续 Worker 可重复调用。该语义是至少一次，不是 exactly-once。

### SciFact 微调 reranker 的 0.905 代表什么？

它是 300 条官方 dev claim 中 188 条带标注 query 的宏平均 nDCG@10；SUPPORT 和 CONTRADICT evidence 文档均算检索正例。它不是 claim truth accuracy 或生成答案正确率。epoch 在同一 dev 上选择，训练一 seed，没有未见 test，所以只能作为探索性结果。

### 有做 Agent 对照或 Citation Support Rate 吗？

没有生成答案或真实模型预算，所以没有执行 single-agent / multi-agent 对照，也没有支持率分数。仓库提供 10 条固定输入和明确的 claim-level 指标协议，后续需先生成同预算输出、人工双标并裁决。

### 怎么解释 Token 和费用？

`maxTokens` 映射模型输出上限；`contextLimit` 以字符数裁剪，不是 tokenizer 精确预算。usage 来自模型返回值；成本是静态单价估算，不等于账单。当前只用本机 Mock 验证接线，没有供应商真实用量数据。

## 四个可用的简历描述

- **LLM Application Engineer**：开发学术研究 Agent Web 原型，打通 PDF 文本解析、章节切块、全语料分页 BM25 与可选 Dense/RRF/Rerank，并保留稳定 chunk 来源和实际页码映射；通过 5,000 条合成 chunk 的本机隔离数据库验证分页命中与查询延迟。
- **AI Agent Engineer**：实现 ScholarKernel 服务端持久化 Job 执行闭环，连接 Next.js Job API、PostgreSQL checkpoint/event、独立 Worker、取消/恢复和 SSE 续读；使用本地 Mock 模型对实际 Route Handler 与 Worker 工作流做集成/E2E 验证，并明确外部调用是 at-least-once。
- **ML Engineer**：搭建可复核的 SciFact Cross-Encoder 检索训练/评测流程，冻结数据与模型 revision，保存逐 query 预测；独立复算结果显示同一 Hybrid@50 候选池下微调 dev nDCG@10 0.904965、预训练 0.867542。Dev 用于选 epoch，结果不是独立 test，且不等同答案准确率。
- **AI/ML Research Intern**：对 SciFact retrieval 实验进行数据 hash、qrels、候选池、逐 query 指标和 query 级 paired bootstrap 复核；发现 exact-text filtering 后仍存在近文本 train/dev pairs，并将评估结论限定为探索性 dev evidence retrieval，不外推生成答案或用户 PDF。

## 负责人应能独立解释

1. WorkflowNode schema 与依赖排序；失败、取消、人工干预如何传播并写入 checkpoint。
2. AgentJob lease/event sequence/checkpoint 的事务边界，至少一次语义及模型调用重复风险。
3. PDF 坐标排序、跨页章节切块、parser resource cleanup、OCR 和页码映射限制。
4. BM25 IDF/平均长度为什么需要全 corpus；keyset cursor 为什么避免 OFFSET；Dense/RRF/Rerank 的计算差异。
5. chunk ID、来源 ID、引用编号、原始句子与页码映射怎样追踪，缺数据时为何保留 unknown。
6. SciFact qrel 把 SUPPORT/CONTRADICT 当作证据检索正例的定义；为什么 112 条无标签 query 不得当成负例。
7. dev 选择导致的偏差、近重复 query 风险、paired bootstrap 解释，以及独立冻结 test 的设计。
8. `maxTokens`、字符裁剪、模型实际 usage 与静态成本估算的区别。
9. 哪些路径经过真实本地数据库/Worker，哪些只由 unit Mock 验证；哪些外部模型/生产/安全检查未进行。
