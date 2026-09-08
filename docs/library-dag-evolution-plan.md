# Library RAG 与 Agent DAG 演进计划

## 约束

- 保留关键词检索、认证、私有对象存储、SSE、AgentJob 与已有 checkpoint。
- 只采用单进程 DAG 调度；不引入 reranker、外部队列或独立 Worker。
- 数据库变更均为增量 migration，旧 DocumentChunk 与旧 WorkflowNode 继续可读。

## 阶段与验收

1. **基线**：固定小型检索集；记录 Recall@10、引用命中率、检索延迟、估算 token 与付费查询成本。Agent 基线映射现有顺序、失败、取消和恢复测试。真实回答证据覆盖率在没有固定回答生成器时标为未测量。
2. **结构化证据**：Library 返回含文档、chunk、标题路径、页码、段落位置和各路排名的对象；Agent 在 token 边界格式化。
3. **混合检索**：BM25 与 pgvector 并行召回，RRF 融合；向量不可用时明确降级；执行去重、文档配额、相邻块合并。
4. **职责拆分**：Planner、Validator、Scheduler、NodeRunner、Persistence、EventPublisher 成为独立边界，旧 AgentExecutor 保留兼容入口。
5. **真实 DAG**：显式 dependsOn、通用并发、真实依赖边；旧计划自动转换为顺序依赖。
6. **可靠性**：输入与上游指纹校验、原子 checkpoint、幂等、重试、超时、取消传播、失败策略和运行租约恢复。

## 初始基线（2026-09-08）

- 相关测试：8 个文件、39 项测试通过。
- 关键词算法：自定义词项集合重合分数，不是 BM25。
- 向量召回：不存在。
- 执行模型：数组顺序循环；Peer Review 是特例并行。
- checkpoint：按节点 ID 和数组前序恢复；未校验输入或上游结果指纹。
- 节点快照：异步 upsert，和 AgentJob checkpoint 不具备原子性。
- 取消：SSE 路由会把 Job 标记为 cancelled；尚无通用 DAG 下游传播。
- Recall@10、引用命中率、延迟与 token 基线由 `npm run eval:library` 实时输出；回答证据覆盖率当前未测量。

每阶段完成后在本文件追加验证结果、风险与下一阶段。

## 阶段记录（2026-09-08）

### 阶段一：基线

- 修改：新增固定的 8 个 chunk、4 个查询的离线评测集，以及 Library/DAG 可重复执行脚本。
- 验证：旧关键词基线 Recall@10=1.00、引用字段命中率=1.00；顺序执行最大并发=1。
- 风险：样本很小且没有固定答案生成器，回答证据覆盖率明确为未测量。
- 下一阶段：保留兼容入口，引入结构化证据与版本化索引元数据。

### 阶段二：结构化证据与索引元数据

- 修改：证据保留 document/chunk ID、标题层级、页码、段落范围、两路排名、融合排名和解释；Document/DocumentChunk 增加文件与版本指纹、embedding 状态。
- 验证：格式化后引用和位置字段测试通过；旧字符串上下文入口保留为适配层。
- 风险：历史 chunk 需主动分批 reindex 才能获得新元数据和 embedding。
- 下一阶段：BM25 与向量并行召回并以 RRF 融合。

### 阶段三：混合检索与异步索引

- 修改：实现 BM25、pgvector、RRF、去重、单文档配额、相邻块合并和预算；embedding provider 独立配置；上传通过 AgentJob + `after()` 异步索引；PATCH reindex 支持增量回填。
- 验证：关键词单路、向量故障降级、确定性融合、配额/合并、版本跳过与变化重建测试通过。
- 风险：真实向量召回质量、Neon HNSW 延迟和付费 embedding 成本需要预发布环境测量。
- 下一阶段：拆分执行边界并迁移为显式依赖 DAG。

### 阶段四与五：边界拆分与真实 DAG

- 修改：Planner、Validator、Scheduler、NodeRunner、Persistence、EventPublisher 独立；旧计划顺序规范化；ready 节点按并发上限调度；Peer Review reviewer 走通用 DAG 并发；TopologyView 使用 dependsOn。
- 验证：合法/非法图、并发上限、汇聚门控、数组乱序依赖执行和 Peer Review 兼容测试通过。
- 风险：单进程执行仍受 Serverless 单次函数生命周期约束，这一阶段有意不引入外部队列。
- 下一阶段：补齐指纹恢复、事务、取消、超时、失败策略和租约。

### 阶段六：可靠性与恢复

- 修改：节点输入/上游指纹、幂等键、原子节点与 Job checkpoint 写入、重试/退避/超时、三种失败策略、显式取消、SSE 断开解耦、完成态 DB 回放和过期租约恢复。
- 验证：失败、取消、checkpoint 失效、事务顺序、SSE 断开/重连均有自动化覆盖。
- 风险：进程被平台终止后不会自行继续计算；租约会把事实状态转成可恢复错误，需要客户端或操作者显式续跑。
- 下一阶段：在有授权的 staging clone 上执行 migration、真实 Blob、真实 embedding 与断连恢复 smoke；生产仍不变更。
