# Library RAG 与单进程 DAG 交付报告

## 结果

本阶段把 Library 从“关键词片段拼接”升级为结构化证据管线，并把复杂 Agent 工作流从数组顺序循环升级为显式 `dependsOn` 的单进程 DAG。认证、私有对象存储、既有 API、SSE 协议、AgentJob 和旧计划兼容入口均保留；没有引入 reranker、Redis 队列、消息总线或独立 Worker。

## 架构边界

- Library：布局解析与版本指纹 → BM25/pgvector 并行召回 → RRF → 去重、配额、相邻合并和预算 → Agent 边界格式化稳定引用。
- 索引：上传请求只完成对象与 Job 持久化；`after()` 在同一部署单元中执行索引。相同文件/解析器/分块器/embedding 模型复用索引，变化时重建。
- Agent：Planner 生成 DAG；Validator 拒绝非法图；Scheduler 运行 ready 节点；NodeRunner 隔离单节点执行；Persistence 原子保存节点事实和 Job checkpoint；EventPublisher 在持久化后发布 SSE。
- 恢复：数据库是事实来源。传输断开不取消任务；显式 DELETE 才传播取消。完成任务重连从数据库回放。输入或上游指纹变化会使旧结果失效；启动扫描会标记已过期租约，若进程在租约到期前重启而扫描尚未命中，后续重连会在租约到期后通过条件更新原子接管，避免永久 `running` 或双重执行。

## Migration

`20260908173000_hybrid_rag_dag` 增量启用 `vector`，为 Document/DocumentChunk 增加文件、解析、分块、embedding 元数据及 1536 维向量/HNSW 索引，并为 AgentJob/AgentNode 增加心跳、租约、指纹、尝试次数、幂等键、错误类别和输出快照。`20260908203000_content_aware_chunks` 只新增有默认值的 `contentKind`，用于区分正文、表格、公式和参考文献。两者都不删除或改写现有文档正文、Job 或节点结果。

## 离线前后对比

- Library 固定集已扩为 130 个有人工相关性标签的学术问题，覆盖 15 个主题、120 个可回答问题和 10 个无答案问题，并包含精确词、同义词、中英跨语言、冲突证据和跨段证据。旧基线 → 当前实现：Recall@5/10 0.7917 → 0.9750，MRR 0.7667 → 0.9750，错误 Top-1 引用率 0.2583 → 0.0250，人工 Top-1 相关率 0.7417 → 0.9750，无答案误引率均为 0，引用元数据命中率均为 1。两次本机同进程运行中，当前实现为 16–34ms（旧基线 12–22ms），估算上下文 token 9774（旧 7642），离线付费查询成本为 0；这些延迟不代表 Neon 或线上网络延迟。
- Agent 固定图：数组顺序基线最大并发 1；DAG 最大并发 2，3/3 节点完成，依赖违规 0。最终验收计时为 29.348ms 对 26.563ms，仅证明调度行为，不作为容量结论。
- 检索策略现包含标题 3×、标题路径 2×、正文 1× 的 BM25F 权重，按查询长度调整候选数/RRF k/文档配额，中英学术词扩展，以及表格、公式、参考文献的独立分块预算。embedding 请求有批量、限速、瞬态错误退避重试和显式 BM25 降级。
- 运维界面显示逐文档 pending/ready/degraded/failed、chunk 数、模型和错误，支持单文档重试及每批最多 50 个、用户隔离的陈旧索引扫描/回填。结构化指标只允许延迟、候选数、降级原因、节点重试/错误、最大并发、租约恢复数、embedding 请求/token 估算等字段，不记录查询、文档正文、API key 或 Cookie。
- 未测量：固定答案生成器缺失，因此回答证据覆盖率未测量；真实 embedding 召回增益、Neon HNSW p50/p95、付费 embedding/API 成本、Serverless 长任务完成率和真实断连/重启恢复时长均未测量，不做推断。没有这些 staging 数据前不调整 HNSW 参数。

## 部署与回滚

部署前必须在获授权的 staging clone 上确认 pgvector 权限并运行 `prisma migrate deploy`，配置独立的 `EMBEDDING_API_KEY`（或接受显式 BM25 降级），验证 Blob 上传、异步 index Job、混合查询、DAG 取消/恢复和浏览器凭据审计。历史文档既可通过 `PATCH /api/documents` 的 `reindex: true` 单篇回填，也可通过 `/api/documents/reindex` 做有界批处理。

当前工作目录没有 `STAGING_DATABASE_URL`、staging 应用地址/认证、embedding 或 Blob 凭据，也没有获授权的重启钩子，因此本轮没有连接 Neon、调用模型、操作远端 Blob 或触发部署重启。仓库已提供默认不联网、目标主机双重校验的 `verify:staging:rag-dag` 和 `smoke:staging:release`；真实结论仍须在上述变量注入后运行并保存输出。

回滚时先部署上一应用版本，保留所有增量列、索引和扩展；它们不会影响旧代码。不要手工改迁移历史，也不要为回滚删除文档对象或 chunk。完整操作见 `deployment.md`。
