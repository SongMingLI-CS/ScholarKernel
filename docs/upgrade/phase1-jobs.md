# Phase 1：服务端持久化 Agent Job

## 兼容迁移

默认保留原客户端执行；设置 `AGENT_DURABLE_JOBS=1`、构建时设置 `NEXT_PUBLIC_AGENT_EXECUTION=server` 并启动 `npm run worker`，普通聊天和科研任务走同一服务端 Job。`localOnly` 保留浏览器本机 Ollama 路径。回滚时关闭前端开关、重新构建；数据库为增量迁移，保留旧 done/error 状态和旧 API 行为，不回滚或删除已保存数据。

Worker 必须在长期运行的 Node 进程中部署。仅部署 Next.js/serverless HTTP 函数不会自动消费队列。没有 Worker 的任务保持 pending；运维应监测 pending 等待时间和租约超时。

## 状态转换

- pending → running：Worker 原子认领。
- running → completed / partial / failed：保存终态结果和事件。
- running → waiting_for_input：检查点和介入事件落库后释放 Worker。
- waiting_for_input → pending：归属和待决节点确认后，事务写入唯一决定和 intervention_applied 事件。
- pending / waiting_for_input → cancelled：取消立即落库；running 先记录请求，Worker 将信号传播至模型和搜索调用，然后保存 cancelled。
- failed / partial / cancelled → pending：显式重试，保留完成节点，受 maxAttempts 限制。
- running 的租约过期 → running：新 Worker 认领，换新 fencing token，恢复最后提交的检查点。达到上限后转 failed。

旧 legacy 任务仍使用 done/error，不能按新持久化保证解释其行为。

节点仍按已校验的列表顺序执行；先前结果作为后续节点上下文。Peer Review 内的两位 Reviewer 独立并行，二者都完成后再进入后续阶段。没有引入任意 DAG 调度器，也不承诺按未定义的 dependsOn 字段调度。

## 持久化与幂等边界

Job 包含所有者、工作流版本、配置、节点检查点、执行次数、租约、取消请求和时间信息。密钥通过原加密设置服务提供，不存入 runConfig。节点开始、完成或失败与对应检查点在一个数据库事务内保存；进入下一节点前等待写入。Peer Review 每个独立评审完成后保存，恢复时跳过已完成评审和普通节点。修复原先完成 R1/R2 后跳过整个 Peer Review 组的问题。

Worker 每 250ms 检查取消/租约，租约为 30s，默认最多 3 次执行（包含恢复和人工决策后的继续执行）；单次 Worker 执行上限 10 分钟。SDK 每次模型请求仍有 60s 超时和 1 次重试。数据库故障时放弃当前未提交写入，等待租约恢复。达到执行次数上限需要人工检查并创建新任务，不能无限重试。

这是**至少一次执行**。检查点提交前进程退出可能重复已发生的模型调用和产生费用；fencing 防止旧进程提交新状态，不能撤销已发出的外部调用。没有承诺外部副作用恰好一次。终态结果、消息更新和 job_completed 事件在同一事务内提交。用量写入在服务器返回前等待完成；提供商未返回用量时不估算为真实 Token。

## 事件与刷新

AgentJobEvent 使用唯一 `(jobId, sequence)` 和稳定事件 ID；事务内增加序列号。SSE 支持 Last-Event-ID / after，按序读取并定期结束连接由浏览器重连。GET 不执行任务。主要事件含 job_created、node_started、node_completed、node_failed、output_delta、intervention_required、intervention_applied、job_completed、job_failed；还记录恢复、取消和检查点事件。output_delta 按时间合并为累计内容，终态包含完整结果，不承诺逐 Token 投递。

浏览器保存 Job 与会话/回答消息的关联，刷新后查询当前会话最近任务并观察事件。刷新仅断开观察；“停止”按钮发出服务端取消请求。服务端模式的 assistant 消息由 Worker 写入，避免浏览器延迟保存覆盖终态。

## 验证与限制

已在新建隔离 PostgreSQL 18.6 上执行真实持久化测试：顺序事件重放、租约接管、过期凭证拒绝写入、取消、人工暂停/决定/新 Worker 恢复、有限重试、消息终态事务、并发认领、次数上限和实际 SSE 路由游标读取。

跨进程测试由第一个 Node 进程提交 read_file 节点检查点后退出，再由第二个 Node 进程调用实际 AgentExecutor 执行剩余节点，验证已完成节点未重做。普通聊天使用实际 Worker + Executor 和 Mock 模型；Mock Token 仅用于用量保存断言，不是实测模型数据。

真实外部模型、跨主机部署、连接池大并发及生产进程管理器重启没有验证。迁移前历史 legacy Job 不自动转为 durable。新增状态和检查点类型有 workflowVersion，当前只支持版本 1；不支持任意跨版本恢复。

本阶段本地验证记录：隔离 PostgreSQL 18.6 上 `npm run test:upgrade` 为 9 个文件、22 个测试通过；额外计费回归 10 个测试通过；浏览器普通对话刷新恢复流程 1 个通过（浏览器对 Job API 使用确定性模拟，后端持久化由上述真实数据库测试覆盖）。`npx tsc --noEmit`、`npm run lint`、`npm run build` 均通过。另在空白隔离数据库应用 8 个迁移，重复 `prisma migrate deploy` 无待处理迁移，schema diff 无差异。浏览器日志仍有 React Flow nodeTypes/edgeTypes 重建提示、Next middleware 弃用提示；未在本阶段改动 UI 或代理配置。
