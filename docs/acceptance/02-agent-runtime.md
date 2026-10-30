# Phase 5.2：服务端 Agent 执行闭环验收

## 实际执行路径

服务端模式由 `NEXT_PUBLIC_AGENT_EXECUTION=server` 控制客户端；用户选择 `localOnly` 时仍保留本地执行。客户端提交 durable 请求后，`POST /api/agent/jobs` 创建 Job，`scripts/agent-worker.ts` 轮询并通过 lease 认领任务，`runNextDurableJob` 调用 `runAgentOnServer`，检查点和事件由 PostgreSQL 事务写入。状态接口提供刷新后的快照，SSE 按 `Last-Event-ID` 续读事件。未启用服务端模式的旧客户端仍使用旧执行路由，兼容路径尚未删除。

新增 `e2e/durable-worker-runtime.spec.ts`：Playwright 启动真实 Next.js dev server；测试通过 loopback HTTP 调用实际 Next API，启动独立 `scripts/agent-worker.ts` 进程，并将 OpenAI-compatible API base URL 指向测试内的合成 HTTP 服务。该服务提供固定返回，不调用供应商或外部模型。

端到端覆盖了两种执行：

1. 普通聊天：HTTP 创建 Job → Worker 认领 → 模拟模型输出 → HTTP 状态读取 → 实际 SSE 接口从 cursor 1 续读终态事件。
2. 工作流：模拟 Planner 返回一个合法 reasoning 节点 → AgentExecutor 执行节点 → Worker 保存完成节点与最终文本。

测试同时检查模拟模型请求次数和事件序号。Worker 在任务后收到 `SIGTERM` 并正常退出。CI 浏览器测试步骤只给 mock 使用 `OPENAI_API_KEY=local-fixture-key`；Job 的 base URL 指向本地 fixture。

## 故障恢复与状态验证

在新建隔离 PostgreSQL 的 `durable-jobs.integration.test.ts` 中，10 项通过：

- 完成结果写入、按序读取事件、使用末尾游标不重复回放。
- 恢复前已完成的节点保持完成，并通过两个独立 Node 进程验证检查点恢复。
- 租约过期后重新认领，attempt 递增；旧 lease 写事件失败。
- 运行中的取消请求最终进入 cancelled。
- 人工干预进入等待，decision 幂等写入后由后续 Worker 恢复。
- 两个 Worker 并发 claim 同一 Job 时仅有一个取得任务。
- 达到最大重试次数后进入 failed，显式重试有边界。
- SSE 真实 Route Handler 按游标续读，不重新执行已完成 Job。
- 失败 Job 记录终态并支持显式重试。

新增 Route Handler HTTP harness 用例与原有真实 Worker/Executor 聊天用例、文档索引用例在首轮执行合计 15 项通过。后续增加两项 RAG 覆盖（>1,000 chunks 的晚段证据和合成性能记录），重跑同一隔离数据库集成组合的最终结果为 17 项通过。工作流 E2E 的实际 Next HTTP/Worker 测试 1 项通过。前端浏览器“刷新”用例 `e2e/durable-job.spec.ts` 仍拦截 API，不能替代完整浏览器 + 数据库刷新验收；本轮实际验证了状态查询和 SSE 重连接口。

## 幂等边界与限制

- `createDurableJob` 为每次 POST 创建新 ID；客户端 `observeDurableJob` 只读 SSE/状态、不创建或重试 Job。实际 E2E 中多次 GET 只观察同一 Job。客户端重复发送创建 POST 本身没有 idempotency key。
- EventSequence 在同一事务内递增并插入事件；唯一约束为 `(jobId, sequence)`。SSE cursor 使用 `jobId:sequence`，已在集成用例中验证。
- `recordTokenUsage` 在同一事务内创建审计行并累加 `UserBilling`，因此单次数据库事务不会只完成一半；系统没有对外部模型调用提供 exactly-once 保证。Worker 在模型已完成、检查点尚未提交时失去 lease，后续 Worker 可能重做该调用并产生新的 usage 记录。usage 行没有每次模型调用的持久幂等键，故无法证明跨重试全局去重。
- 运行时最长 10 分钟，lease 每 250 ms heartbeat、租约 30 秒。异常停止后的恢复依赖租约到期和最多 3 次 attempt；SIGTERM 在当前 Job 完成后退出，不会中断正在执行的模型请求。
- 本轮没有真实模型调用、模型 Token/成本账单、真实用户文档、生产 Worker、浏览器断网再连 GUI 场景，也没有执行任何身份、权限或安全测试。

## 实际运行结果

- `npx playwright test e2e/durable-worker-runtime.spec.ts --workers=1 --retries=0`（CI 环境变量、隔离 DB、本地 mock endpoint）：1 项通过。
- `npx vitest run --no-file-parallelism src/lib/__tests__/durable-jobs.integration.test.ts src/lib/__tests__/document-index.integration.test.ts src/lib/__tests__/server-chat.integration.test.ts src/lib/__tests__/agent-runtime.integration.test.ts`：首轮 4 个文件 / 15 项通过；增加 RAG 用例后最终重跑结果见 `03-academic-rag.md`。
- 探索测试中，Ollama provider 可以执行直连聊天，但工作流 Planner 默认走 cloud key；未提供真实密钥时返回 `MissingApiKey`。因此工作流 E2E 使用本地 OpenAI-compatible fixture 和测试占位 key。另一次初始 mock SSE fixture 的事件分隔符不符合 SSE，导致空输出；修正 fixture 后最终用例通过。没有因此修改运行时模型或工作流逻辑。
