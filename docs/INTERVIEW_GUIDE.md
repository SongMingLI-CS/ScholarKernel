# ScholarKernel AI/LLM 工程面试指南

## 1 分钟项目介绍

ScholarKernel 是一个学术研究 Agent Web 原型。用户输入研究问题后，Planner 把问题拆成带类型和依赖的工作流节点；Executor 调用学术搜索、文档读取和模型推理，再把带来源编号的结果整合为回答。长论文和 PDF 会经过文本抽取、章节切分和检索排序。项目还包含并行同行评审、检查点、取消与人工干预流程。

工程重点是把模型调用接入现有业务流程：明确节点状态、保存可恢复的 Job 结果、在上下文中传递来源编号、按 Agent 记录模型返回的 Token 用量，并让失败通过可理解的错误反馈到 UI。另有独立 PyTorch 研究工程，在 SciFact 上比较检索方法并微调本地 Cross-Encoder；没有自行训练基础模型或 Embedding。

目前它适合作为 AI/LLM 工程实习的代表性原型，展示模型编排、流式交互、RAG 数据处理和工程可靠性改进。检索实验只覆盖 SciFact 英文 dev，dev 被用于模型选择，没有 Agent 对照、独立 test 或显著性检验；结果不代表用户文档或生成答案质量。介绍时也应说明浏览器内执行与服务端持久化 Job 尚未完全统一、没有 OCR、真实供应商调用未验证、成本是静态价格估算；不要称为生产就绪系统或宣称未经测量的准确率提升。

## 架构讲解顺序

1. **入口与状态**：`src/components/chat-panel.tsx` 负责对话界面，`src/hooks/use-chat-send.ts` 管理一次聊天发送和流式 UI 状态，Zustand store 保存会话视图状态。
2. **计划与执行**：`src/lib/agent/planner.ts` 定义节点协议；`src/lib/agent-executor.ts` 规划并执行节点；`src/lib/agent/peer-review-runner.ts` 实现并行 Reviewer、辩论、主席汇总和人工干预。
3. **Job 持久化**：`src/app/api/agent/jobs/route.ts` 保存节点更新、来源、部分结果和同伴评审检查点；`src/app/api/agent/jobs/[id]/resume/route.ts` 接续可恢复 Job；`src/lib/agent-jobs.ts` 管理数据库状态。
4. **文献处理**：`src/lib/document/pdf-parser.ts` 通过 PDF.js 提取文字；`column-reorder.ts` 使用坐标恢复栏顺序；`academic-semantic-chunker.ts` 识别章节并生成有界文本块。
5. **检索与引用**：`src/lib/document/search-conversation-chunks.ts` 在 BM25 与可选 Dense 结果间做 RRF；`src/lib/tools/academic-search-strategy.ts` 合并网络和文档来源、规范化 URL 和分配引用编号；`src/lib/document/rerank-gateway.ts` 运行可选重排并提供词项降级。
6. **模型和成本**：`src/lib/agent/llm-utils.ts` 封装 Provider、预算、超时、取消、历史裁剪和流处理；`src/lib/billing/token-usage-bridge.ts` 把真实 usage 归到具体 Agent；`token-audit.ts` 和 `billing-metrics.ts` 保存、汇总用量。
7. **数据库迁移**：`prisma/schema.prisma` 描述模型，`prisma/migrations/` 才是 CI 与部署实际执行的结构变更。
8. **离线检索研究**：同级 `../ScholarKernel-reranker/src/benchmark.py` 评测 BM25/Dense/RRF/Cross-Encoder，`train_reranker.py` 训练，`service.py` 通过本机 HTTP adapter 接入；checkpoint hash 与 dev 指标在 `docs/upgrade/phase4-reranker.md`。

## 核心技术原理

### Planner 和有向工作流

Planner 把自然语言任务转换为受 Zod 协议约束的节点。每个节点有稳定 ID、类型、状态和输入；Executor 根据依赖决定执行顺序。并行 Reviewer 使用 Promise 聚合，单个 Reviewer 完成时就保存检查点，避免另一个失败导致成功结果丢失。

可讲清楚的状态：`pending → running → done/error`，用户取消后为 `cancelled`。运行结果也区分 `done`、`partial` 和 `error`，不能只看 Promise 是否 resolve。人工重定向会剪枝后续工作流、插入一条人工指导节点，再继续执行。

### RAG、页码和引用

项目的 RAG 流程包含文档读取、章节识别、分块、来源编号、检索排序和提示词组装。PDF 有坐标时才判断栏顺序；没有坐标的纯文本保留原顺序。来源 ID 在合并检索批次后重新统一，避免同一个引用编号指向不同来源。页码只取真实解析到的页面值；没有映射时留空。

重排回退基于词项和中文 bigram。它不代表语义向量检索。应用现在支持显式配置的本地 Dense service 和 Cross-Encoder；BM25/Dense 以 RRF 融合。本地微调 Cross-Encoder 的 SciFact dev 指标仅是英文 evidence 检索结果，不能外推到中文查询、整篇 PDF、用户文档或生成答案。当前没有 OCR，扫描版 PDF 无法从图像读取正文。

### Token 预算和成本

`maxTokens` 映射到 AI SDK 的 `maxOutputTokens`；`contextLimit` 是按字符裁剪的保护值，不是精确 Token 预算。流式 `text-delta` 是给用户展示的正文，`reasoning-delta` 不进入最终回答。取消通过 AbortSignal 传入模型调用；错误事件作为失败处理，不静默变成空答案。

模型 usage 来自 AI SDK/供应商返回的 Token 数。当前成本是静态单价计算的估算值，不能说是账单金额；真实 provider 行为需要真实 API Key 才能核验，本轮没有进行真实调用。

## 常见追问

### 为什么用 PDF.js？

之前的实现把 PDF 原始字节当文本并查找 `stream`，无法稳定解析对象引用、压缩内容流和字体映射，还可能让同步循环不退出。PDF.js 负责 PDF 结构、解压和文字项解析；应用层再做版面排序、章节识别和分块。它不自动提供 OCR，因此扫描图像仍需额外 OCR 系统。

### 如何避免模型引用错文献？

检索结果去重后集中分配来源 ID；推理提示词和最终参考文献列表使用相同编号。PDF 页码必须有解析器的实测页映射，否则不生成页码。引用来源的完整性依赖搜索服务返回的数据，项目不会补造 DOI 或页码。

### 如何解释 Dense 检索和自训练 Reranker？

主应用的 Dense 和 Cross-Encoder 都是 opt-in 本地服务；向量和版本保存到 `DocumentChunk`，BM25 与 Dense 通过 RRF 融合，服务失败时仍可降级。独立研究工程用 SciFact train 微调 Cross-Encoder，在 188 个带 qrels 的 dev query 上评估排序。Dev 同时参与 epoch 选择，没有独立 test 和显著性检验；不能据此说用户文件检索更准或答案更可信。checkpoint 权重不在 Git 中，服务只在研究环境实测。

### Job 如何恢复？

服务端 Job 把节点、部分结果、来源和同行评审阶段写入 checkpoint；resume 路由读取 checkpoint 并把已完成节点交给 Executor 跳过。当前恢复入口面向明确的 `cancelled`、`error`、`partial` 状态；系统尚未自动扫描进程崩溃留下的 `running` Job。普通浏览器内执行路径也未完全切到持久化 Job，因此需明确说明恢复能力覆盖范围。

### 如何解释 Token 和成本？

输出 Token 预算传给 SDK 的 `maxOutputTokens`；输入上下文上限是字符级裁剪。用量按 `planner`、`reasoning`、`peer_review` 等 Agent 标记并保存供应商返回的 usage。展示成本由静态价格表推算，可能与供应商账单因缓存、折扣、模型版本和价格变动不同。

### 怎么验证？

CI 从空 Postgres 运行所有迁移、重复运行并比较 schema；功能测试用本地样本、Mock 和固定行为验证；PDF 测试覆盖单栏、双栏、压缩流、空白文档和超时资源清理。Playwright 测试覆盖健康接口和输入草稿交互，不发送模型请求。没有真实用户语料、生产数据库或真实模型 API 参与这些检查。

## 负责人需要亲自掌握

- 能解释每一种 WorkflowNode 的输入输出、失败传播、取消状态以及检查点何时写入。
- 能从 `/api/agent/jobs` 一直讲到 `AgentExecutor` 和 Prisma checkpoint，并说明浏览器执行路径与服务端 Job 的差异。
- 能解释 PDF.js 文本项、页面坐标、栏排序和页面映射，指出无 OCR、图片 PDF 和复杂版面限制。
- 能说明章节 chunk 的边界、来源 ID 如何跨批次统一、RRF 和 Cross-Encoder 的区别、训练数据泄漏检查及结果适用范围。
- 能区分字符数与 Token 数、输入预算与输出预算、模型返回 usage 与静态价格估算。
- 熟悉 Prisma schema、迁移顺序、空数据库迁移和部署时只执行 `migrate deploy` 的原因。
- 能坦诚说明未做真实模型调用和完整真实数据库 E2E，且静态测试不能证明学术答案准确。
- 先阅读并理解 `docs/audit/technical-audit.md` 中尚未处理的安全审计事项；这些事项不属于本轮修复，不要宣称系统已完成安全审计或适合公开生产部署。
