# Library RAG 与单进程 DAG 交付报告

## 结果

本阶段把 Library 从“关键词片段拼接”升级为结构化证据管线，并把复杂 Agent 工作流从数组顺序循环升级为显式 `dependsOn` 的单进程 DAG。认证、私有对象存储、既有 API、SSE 协议、AgentJob 和旧计划兼容入口均保留；没有引入 reranker、Redis 队列、消息总线或独立 Worker。

## 架构边界

- Library：布局解析与版本指纹 → BM25/pgvector 并行召回 → RRF → 去重、配额、相邻合并和预算 → Agent 边界格式化稳定引用。
- 索引：上传请求只完成对象与 Job 持久化；`after()` 在同一部署单元中执行索引。相同文件/解析器/分块器/embedding 模型复用索引，变化时重建。
- Agent：Planner 生成 DAG；Validator 拒绝非法图；Scheduler 运行 ready 节点；NodeRunner 隔离单节点执行；Persistence 原子保存节点事实和 Job checkpoint；EventPublisher 在持久化后发布 SSE。
- 恢复：数据库是事实来源。传输断开不取消任务；显式 DELETE 才传播取消。完成任务重连从数据库回放。输入或上游指纹变化会使旧结果失效；过期租约转成可恢复错误。

## Migration

`20260908173000_hybrid_rag_dag` 增量启用 `vector`，为 Document/DocumentChunk 增加文件、解析、分块、embedding 元数据及 1536 维向量/HNSW 索引，并为 AgentJob/AgentNode 增加心跳、租约、指纹、尝试次数、幂等键、错误类别和输出快照。它不删除或改写现有文档正文、Job 或节点结果。

## 离线前后对比

- Library 固定集：旧实现与新 BM25 兼容路径 Recall@10 均为 1.00，引用字段命中率均为 1.00，估算上下文均为 246 token，离线付费查询成本均为 0。最终验收同进程耗时为旧 1.141ms、新 1.429ms；数据量太小，仅用于回归，不代表线上性能。
- Agent 固定图：数组顺序基线最大并发 1；DAG 最大并发 2，3/3 节点完成，依赖违规 0。最终验收计时为 29.348ms 对 26.563ms，仅证明调度行为，不作为容量结论。
- 未测量：固定答案生成器缺失，因此回答证据覆盖率未测量；真实 embedding 召回增益、Neon HNSW p50/p95、embedding/API 成本、Serverless 长任务完成率和真实断连恢复时长均未测量，不做推断。

## 部署与回滚

部署前必须在获授权的 staging clone 上确认 pgvector 权限并运行 `prisma migrate deploy`，配置独立的 `EMBEDDING_API_KEY`（或接受显式 BM25 降级），验证 Blob 上传、异步 index Job、混合查询、DAG 取消/恢复和浏览器凭据审计。历史文档通过 `PATCH /api/documents` 的 `reindex: true` 分批回填。

回滚时先部署上一应用版本，保留所有增量列、索引和扩展；它们不会影响旧代码。不要手工改迁移历史，也不要为回滚删除文档对象或 chunk。完整操作见 `deployment.md`。
