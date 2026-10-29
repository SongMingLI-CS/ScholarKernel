# AI / LLM 实习面试能力评估

依据提交 `e129eb65e6bcbf6c2df9696c282613a557b672f1` 及已完成证据。这里只评估“项目能提供什么能力证据”，没有对负责人进行现场考核，不能由 AI 生成代码的规模推定其个人掌握程度。

## 1. 总体判断

**可以作为 AI 应用工程实习的原型项目来讲，但目前尚不足以作为经得住深入追问的高质量主项目。** 缺口主要在可靠执行、数据边界、PDF 正确性和独立评测。若投 LLM 应用/Agent 工程岗位，修完关键问题并亲自理解代码后有继续投入价值；若投机器学习算法、深度学习训练岗位，目前缺 Python/PyTorch 训练与实验成果，不能靠这个项目代替。

实际亮点是多模型流式工程、固定评审并行/汇总流程、带来源的检索与持久化基础。不能把“有 Agent”“有 RAG”“有 243 测试”分别解释为自主决策算法、自主训练检索器和完整产品验证。

## 2. TypeScript / Python 工程

**对应模块**：AgentExecutor、API、Zustand；核心 `agent-executor.ts`、`agent/executor-types.ts`、`useAgentStore.ts`。本仓库主体 TypeScript；未发现可证明 Python 训练能力的模块。

**可能追问**：unknown 与 any 如何取舍？类型断言能否校验网络 JSON？异步异常如何传播？为什么测试运行通过但 tsc 失败？如何处理流、取消和模块边界？

**必须理解**：编译时类型与运行时校验的区别、Promise/事件循环、AbortSignal、可判别联合类型（Discriminated Union）、模块依赖与测试替身。

**亲自练习**：实现一个带运行时 Schema 的请求解析器，以及可取消 AsyncIterable 消费器；保留错误/partial 状态；修复 8 个类型错误并解释原因。用 Python 单独写数据清洗/指标计算，证明两种语言能力。

**不足与证据补充**：`parseJsonBody<T>` 只是强转，不是真实校验；Store/Executor 体积较大，部分职责重叠。需本人解释核心路径并提交小范围、可复核的实现，不用大重构掩盖问题。

## 3. 后端架构

**模块/代码**：App Router API、`agent-server-run.ts`、`src/hooks/use-chat-send.ts:219`、`app/api/agent/jobs/route.ts:39`。

**追问**：Agent 究竟跑在浏览器还是服务器？Job POST 为什么一直等待？serverless 请求超时后会怎样？UI hooks 和数据库谁是状态真值？

**原理**：请求生命周期、控制平面与运行状态、后台 worker、流式传输、幂等和单一权威状态。知道何时单进程足够，也知道何时需要队列，不靠罗列 Redis/Kubernetes 展示深度。

**亲自练习**：画出一条真实聊天调用链，设计最小 run/step API 和状态转换；先实现一个服务器权威执行路径和客户端订阅，避免一次换全部框架。

**不足/证据**：双执行入口的计费、人工干预和恢复没有统一。需能演示状态在 UI、API、数据库一致，以及失败时如何呈现。

## 4. 数据库与持久化

**模块/代码**：`prisma/schema.prisma`、三份 migrations、`messages/route.ts:35`、`billing/token-audit.ts:30`、`agent-jobs.ts`。

**追问**：db push 与 migrate deploy 区别？为什么迁移通过却运行缺表？事务能否自动防止跨租户更新？如何设计幂等写入和并发文档版本？

**原理**：外键、唯一约束、索引、事务隔离、原子 increment、授权条件、CAS、迁移可重复重建。能说明 ORM 方便在哪里、并没有解决什么。

**亲自练习**：从空 PostgreSQL 仅靠迁移构建完整 schema；写两租户消息归属回归测试；将 Document.version 改为带期望版本的更新并处理冲突。

**不足/证据**：已确认缺两表、消息归属更新漏洞；持久化定时器未体现可靠确认。需迁移 diff 无差异、真实数据库隔离测试和断线后数据一致性证据。安全问题后续只做防御性修复与授权测试。

## 5. 并发与异常恢复

**模块/代码**：`peer-review-runner.ts:355`、`human-intervention-gate.ts:22`、`jobs/route.ts:82-128`、`llm-utils.ts:101`。

**追问**：Promise.all 一边失败会取消另一边吗？R1 已完成为何没检查点？异步写晚到会不会覆盖 done？进程重启后 Map 如何恢复？

**原理**：Promise.all 失败传播而非自动取消、持久化顺序、幂等、至少一次执行（At-Least-Once）、租约和超时、取消与失败分类。外部 LLM 调用和数据库不能简单纳入同一原子事务。

**亲自练习**：每分支完成即保存；用可控延迟写入器验证顺序；实现带 owner/version 的 checkpoint 更新和恢复一个旧任务；人工等待设可恢复状态与期限。

**不足/证据**：当前完整断点恢复未实现；错误流可正常返回。需重启演示、重复提交不重复产生副作用，以及 partial/cancelled 明确区分。当前未完成故障注入，不宣称已证明恢复可靠。

## 6. LLM 基础

**模块/代码**：`llm-utils.ts:43,70,618`、`direct-chat.ts`、`reasoning-runner.ts:183`、`ai-gateway.ts`。

**追问**：temperature 是否决定真实性？上下文窗口与输出上限有何区别？字符数能代表 Token 吗？流中 reasoning 与最终 content 能否混用？结构化输出一定符合业务 Schema 吗？

**原理**：自回归生成（Autoregressive Generation）、分词（Tokenization）、采样、上下文/输出预算、工具调用与 Schema、模型错误及评测不确定性。

**亲自练习**：记录实际请求与 usage，尊重用户上限；分别处理正文、推理事件和错误；同一输入变更温度/预算，分析输出差异，保留费用与失败尝试。

**不足/证据**：512 被提升为 8192、规划和评审预算不统一，部分 usage 漏记。需真实运行采样日志与预算验收，但本轮未调用真实供应商。

## 7. Transformer 基础

**对应位置**：项目调用的外部模型基于 Transformer 等架构，但仓库没有 attention、模型训练或推理内核实现。调用 API 本身不证明该理论能力。

**追问**：Q/K/V 的形状、scaled dot-product attention 的缩放、causal mask、位置编码、残差/归一化、KV cache；编码器与解码器在检索/生成中的区别。

**原理**：注意力计算、训练目标、前向/反向、计算与显存复杂度、推理阶段 prefill/decode 区别。能写公式并解释张量维度，不要求从头训练大模型。

**亲自练习**：在独立 Python 仓库实现小型 scaled attention，和 PyTorch 对照，验证 mask/维度/梯度；再实现最小训练循环和保存/恢复 checkpoint。

**不足/证据**：当前项目缺直接证据。补可运行 notebook/测试、学习曲线和错误分析；不能把外部模型描述当作自己的实现亮点。

## 8. Agent 原理

**模块/代码**：`planner.ts`、`agent-executor.ts:178,576`、`peer-review-runner.ts:294`、`agent-personas.ts`。

**追问**：Agent 与固定工作流区别？这里真有通用 DAG 吗？不同角色是否独立？多 Agent 为什么可能更差？终止与工具授权在哪层保证？

**原理**：规划/执行、工具协议、共享上下文与污染、固定编排与动态决策、成本收益、相关性错误、Human-in-the-Loop（人在回路）和终止条件。

**亲自练习**：亲自实现一个两个任务的类型化执行器和明确失败状态；修复固定评审组三节点契约；定义 direct/research/peer-review 的独立标签。

**不足/证据**：通用任务是顺序数组，评审依赖角色 Prompt；缺消融。需解释为什么当前三个角色足够，不能通过加角色替代问题定义与实验。

## 9. RAG

**模块/代码**：`tools/search-tool.ts`、`document/pdf-text-extract.ts:54`、`academic-semantic-chunker.ts:154`、`browser-file.ts:75`、`academic-search-strategy.ts`。

**追问**：当前检索的是全文还是网页摘要？为何压缩 PDF 为空？为什么 chunk 页码全是 1？引用格式正确为何仍可能不可信？如何处理未知页码和证据缺失？

**原理**：解析/索引/召回/重排/上下文/生成各层误差；粒度选择、上下文预算、证据溯源（Provenance）、检索失败与生成幻觉的区分。

**亲自练习**：修正文档数据契约并保留 doc/chunk/page/offset；人工标注一小批 PDF 与问答证据；实现一个只从证据 ID 生成引用的最小流程。

**不足/证据**：当前没有完整 Embedding/索引；两类 PDF 错误和单栏打乱已复现。必须有真实语料回归和逐条引用复核，不能只展示界面报告。

## 10. Embedding 与 Reranking

**模块/代码**：`rerank-gateway.ts:25,85,137`；Embedding/向量索引未找到完整实现。

**追问**：Bi-Encoder 与 Cross-Encoder 如何权衡？余弦与点积在归一化后关系？BM25 的 IDF 在哪里统计？reranker 能否补回没召回的相关文献？

**原理**：稀疏/稠密表示、倒排索引、对比学习、候选召回上限、交叉注意力打分、排序损失与负采样。

**亲自练习**：全库 BM25 → 冻结 Dense → 固定候选 CE；手写指标，再对照成熟库。模型训练放独立 PyTorch 项目，并亲自解释数据/损失/梯度。

**不足/证据**：当前词项兜底仅候选内 BM25 风格，中文相关文档也可为 0 分；外部 BGE 接口不是自主训练。需要 qrels、检索 run、真实延迟和公平排序对照。

## 11. 模型效果评测

**模块/代码**：`scripts/test-agent-batch-100.mjs`、历史报告、各 RAG/Agent 单元测试。

**追问**：71.2% 的分子分母是什么？标签是否独立？回答非空算完成吗？为什么 nDCG 与 Recall 都要看？LLM 裁判如何校准？

**原理**：任务 rubric、混淆矩阵、Recall/Precision/MRR/nDCG、人工一致性、置信区间、重复实验、数据泄漏和消融公平性。

**亲自练习**：冻结 30-50 条作为初始开发评测集并另外留独立测试集；定义真实完成条件；计算逐查询指标和失败原因。此规模是建议起步，不是已拥有数据。

**不足/证据**：当前历史脚本混合 route match 与非空回答，现脚本标签预检查存在自循环。需要独立标注、成本/延迟完整日志、A/B/C 配对结果。不得在简历里把历史 71.2% 写成“Agent任务完成率”。

## 12. 部署与可观测性

**模块/代码**：Dockerfile、docker-compose.yml、`.github/workflows/ci.yml`、instrumentation、Job error 字段和 billing。

**追问**：构建通过为什么上线后缺表？健康检查到底测了什么？为什么开发环境 PostgreSQL 18 不能证明生产 16？如何在不记录 Key 的情况下排查失败？

**原理**：可重建镜像、环境配置、迁移顺序、就绪/存活检查、结构化日志、Tracing、服务级指标和价格版本。

**亲自练习**：在可用 Docker 环境从空库完整部署；补数据库就绪与迁移一致性门禁；给单任务串起 request/run/step ID，记录脱敏结构化事件。

**不足/证据**：Docker 运行未验证；Playwright 仅健康；账本缺表且不覆盖主 UI。需要一次标准环境部署录像/日志、失败排障说明和核心用户旅程 E2E。

## 13. 个人掌握门槛与英文简历

负责人至少应能不依赖 AI 解释、修改并验证以下代码：规则分流与计划校验；节点执行/取消/状态聚合；R1/R2 并发及检查点；Prisma 所有权/事务/迁移；解析→chunk→来源 ID；检索/重排打分；指标计算与实验控制。

适合当前事实的保守英文草稿（需本人确实理解并参与后再使用）：

> Built a TypeScript academic assistant prototype with multi-provider LLM streaming, web-based literature retrieval, and role-based parallel review workflows. Implemented conversation persistence with Prisma and PostgreSQL, and audited execution, document-processing, and evaluation limitations using reproducible local checks.

不能使用的表述：trained academic foundation models、production-grade fault-tolerant agents、validated full-text RAG、proved multi-agent superiority、published research，除非后续有对应实证。

修复后再用“在何种数据/模型/预算下，哪个指标从 X 到 Y，代价多少”写量化经历。现在没有这些结果，不填占位数字冒充成绩。项目由 AI 辅助开发本身不是扣分点，无法解释关键决策、测试口径和失败原因才会直接影响可信度。
