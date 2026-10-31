# ScholarKernel Phase 6 最终验收

日期：2026-10-31。分支：`phase6-final-reliability-ai-validation`。基线：`1d8e19da7da7bb4f6c94924e5172ecbfe85ffcb7`（`fix/phase5-acceptance`）。原有提交 `e0ef1b3`、`1e318f6` 已推送到同名远端分支；该分支上的 Actions 验收失败后，新增本地修复提交 `bb1aefd`。修复提交尚未推送，远端分支目前仍指向 `1e318f6bb10bdc4caeda4e50985dfc9781ca9f31`。本轮没有合并或部署。

## 结论摘要

| 项目 | 状态 | 证据边界 |
|---|---|---|
| Phase 6 GitHub Actions | **失败** | [run 41171379894](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41171379894)，`workflow_dispatch`，SHA `1e318f6…`。迁移、测试、TypeScript 和 Lint 通过；一个浏览器测试失败，Production build 因此跳过。 |
| Node 22 CI | **真实验证通过** | Actions 实际使用 Node `v22.23.4`；安装及后续 Node 检查步骤通过。 |
| 当前 11 条迁移与 Schema Parity | **真实验证通过（PostgreSQL 16）** | 本次远端 Job 在 PG16 服务中部署 11 条迁移、重复部署并执行 Schema Parity，三个步骤均通过。 |
| PDF 测试 | **真实验证通过（远端 CI）** | `test:quality` 中 PDF 解析 6 项、生命周期 3 项通过；该步骤总计 24 个文件、135 项通过。 |
| Playwright E2E | **失败** | 4 项通过，`durable-job.spec.ts` 1 项失败；发送按钮在测试输入后变为 disabled，点击超时。 |
| E2E 修复提交 | **尚未远端验证** | 本地提交 `bb1aefd` 为会话详情加载增加等待和可用性断言；推送时 GitHub HTTPS 连接中断，远端仍为 `1e318f6`。 |
| 创建合并请求 | **暂不具备条件** | 远端 CI 为失败状态，修复提交尚未推送，也没有修复后的 Actions 结果。 |
| Agent Web / Worker / DB | **真实验证通过（本机隔离环境，模型为 Mock）** | HTTP Route、独立 Worker、PostgreSQL、事件表和 SSE 有集成及浏览器闭环；不是实际模型效果验证。 |
| RAG 固定合成容量对照 | **真实验证通过（合成数据）** | 5,000 个 Chunk、10 个固定查询、每查询 5 次；结果只适用于此合成基准。 |
| 独立检索测试集 | **真实验证通过（本地固定模型与公开语料）** | 使用 BEIR NFCorpus 官方 test，不将 SciFact dev 重新命名为 test。详见 [AI_RESULTS.md](AI_RESULTS.md)。 |
| 答案支持性与 Single/Multi 对照 | **尚未验证** | 离线评测流程及成对请求已准备；没有模型凭据/调用预算，不生成或伪造答案。 |
| 生产就绪 | **尚未验证** | 没有生产服务、生产数据、生产部署或真实模型 API 验收。 |

## 本地最终检查

- `npm run test:quality`：24 个文件、135 项通过。
- 隔离 PostgreSQL 集成：3 个文件、12 项通过，涵盖 durable Job、真实 Worker/Route Handler Mock 聊天、TokenAuditLog 幂等记录。
- Playwright：`durable-browser-recovery.spec.ts` 与 `durable-worker-runtime.spec.ts`，2 项通过；使用本机 Chrome、隔离 PostgreSQL 和本地 HTTP Mock 模型。
- `npx tsc --noEmit`：通过。
- `npm run lint`：通过。
- `npm run build`：通过，使用隔离数据库 URL。首轮构建先暴露本机 ignored cache 内 symlink 环境问题；将其所属缓存子目录临时移到仓库外后，构建编译、Next.js TypeScript、page data 与 17 个静态页面均完成，退出码 0，缓存目录已恢复。这个 workaround 没有进入代码变更。
- `answer_eval.py`：4 项 Python unittest 通过；仅验证评测准备和评分程序，不代表模型答案效果。
- NFCorpus：323/323 query 的预训练与三个微调 reranker 候选 ID 全相同；2,261 条系统排名记录已保存。对照及敏感性结果见 [AI_RESULTS.md](AI_RESULTS.md)。
- `git diff --check`：通过。

构建仍显示 Next.js `middleware` 命名约定弃用提示；浏览器 E2E 有 React Flow `nodeTypes` 对象重复创建提示。两项均不影响通过结果，本轮没有为清理无关 UI/中间件改动范围。

## 远端 CI 记录与版本兼容

本次将 `e0ef1b3`、`1e318f6` 推送到 `phase6-final-reliability-ai-validation`。工作流的 push 分支过滤器只包含 `main` 和 `fix/**`，因此该 `phase6-*` 分支没有自动触发 Actions；为完成验收，手动触发了 [run 41171379894](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41171379894)。GitHub API 确认该运行对应分支 `phase6-final-reliability-ai-validation`、SHA `1e318f6bb10bdc4caeda4e50985dfc9781ca9f31`，最终状态 `failure`。

该运行实际使用 Node `v22.23.4` 和 PostgreSQL 16。Install、首次迁移、重复迁移与 Schema Parity、普通功能测试、Agent 生命周期测试、持久任务与文档回归、TypeScript、ESLint、Playwright 浏览器安装均通过。数据库有 11 条迁移；两次 `prisma migrate deploy` 和 `prisma migrate diff` 均通过。普通功能测试为 24 个文件、135 项通过，其中 PDF 解析测试 6 项、PDF 生命周期测试 3 项通过。

Playwright 浏览器测试共 5 个用例，4 项通过，`e2e/durable-job.spec.ts` 的“normal chat and page refresh observe one durable Job”失败。失败发生在聊天输入后点击 `send`：切换新会话的详情加载尚未完成，组件清空草稿，按钮变为 disabled。等待会话 URL 与详情响应、确认输入框加载完成并断言按钮启用的修复已提交为 `bb1aefd2b6f9a884dcd8f53fa59aa8fc98f17ff5`。它尚未推送或在远端验证：两次普通推送分别遇到 HTTP/2 framing 错误和无法连接 GitHub 443；未使用强制推送。远端分支仍为 `1e318f6…`，没有针对 `bb1aefd` 的 Actions 运行。由于 E2E 失败，`Production build` 步骤被跳过。

SHA `1e318f6…` 的 Vercel 状态为 `success`，但这是独立于 GitHub Actions 的状态检查，不证明生产目标、生产别名或 Worker 拓扑已验收。

检查的 GitHub Actions 记录：[run 41091103185](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41091103185)，job `124184888677`，`push` 事件，分支 `fix/phase5-acceptance`，SHA 与本报告基线完全一致。

该 Job 使用 Node 20 和 PostgreSQL 16.15。数据库启动健康；Prisma 基线已有 10 条迁移，迁移部署、重复部署和 Schema Parity 阶段通过。`test:quality` 中 5 个 PDF 测试失败，错误为 `Promise.withResolvers is not a function`：锁定的 `pdfjs-dist 6.4.299` 要求 Node `>=22.13.0 || >=24`。其余 23 个测试文件、130 项通过。后续集成/工作流测试、TypeScript、lint、Playwright 浏览器安装及 Next.js build 因失败而跳过。

本分支提交 `e0ef1b3` 将 CI 与 `package.json` engine floor 调整到 Node `>=22.13.0`，同时加入 TokenAuditLog 用量幂等键及去重写入。本次远端 CI 实际使用 Node `v22.23.4`，PDF 解析测试通过。这个结果验证了 Node/PDF.js 兼容及 PDF 用例；整条工作流仍因一个 Playwright 用例失败，不能描述为 CI 全部通过。

基线 SHA 的 GitHub 提交状态还包含 Vercel `success` / “Deployment has completed”。该状态没有证明部署目标是 Production，也没有给出生产别名验证证据，因此仅记作 Vercel 部署流程报告成功，**实际生产部署状态尚未验证**。Vercel 状态与 GitHub Actions 是不同系统，不相互替代。

## Prisma 迁移和 Schema Parity

在本机隔离 PostgreSQL 18.6 新建空数据库 `scholar_phase6_final_empty`：

- `npx prisma migrate deploy`：11 条迁移全部应用成功。
- 重复执行 `npx prisma migrate deploy`：无待处理迁移。
- `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`：`No difference detected`。
- `20261031120000_idempotent_token_usage` 新增 TokenAuditLog `idempotencyKey` 的唯一约束，用于防止稳定幂等键重复记录及重复累计账单。

基线远端 CI 的 PG16 只运行了原 10 条迁移；新增的第 11 条没有 PG16 运行证据。当前本机没有 PG16 服务，不能外推 PG18 的结果为 PG16 验收。数据库为临时隔离数据；未连接、重置或覆盖真实数据库。

## Agent 真实运行闭环

在隔离 PostgreSQL、实际 Next Route Handler、实际 `scripts/agent-worker.ts` 子进程和本地模型 HTTP Mock 中执行：

- 普通聊天 Job 创建、Worker 执行、最终状态及 SSE 事件回放。
- 多节点科研工作流和节点完成检查点。
- R1/R2 并行审稿进入人工等待；审批后继续，重复审批被识别为重复操作。
- 被阻塞的流式模型请求收到取消后进入 `cancelled`。
- Worker 收到 SIGTERM 后退出，再启动 Worker 执行新任务。
- 浏览器加载已有会话和 Job，刷新后通过 SSE 重新接收相同 Job 的后续事件；没有创建重复 Job。
- 已完成的审稿阶段在恢复路径中跳过，不重复调用对应 Reviewer。
- TokenAuditLog 在隔离数据库验证幂等键重复插入不重复累计计费。

定向 PostgreSQL 集成命令运行 3 个文件、12 项通过：`token-audit.integration.test.ts`、`agent-runtime.integration.test.ts`、`durable-jobs.integration.test.ts`。浏览器 E2E 使用本地合成模型，不访问外部 API；测试通过只表示 Worker/HTTP/DB/SSE 状态闭环通过，**真实模型质量、供应商 Token 用量及账单仍尚未验证**。

幂等键只能在调用方复用同一稳定键时去重。外部模型已完成、结果尚未持久化时发生进程故障，恢复后可能重发模型调用；不同调用 UUID 不提供跨供应商重试的 exactly-once 保证。

## RAG 容量和索引选择

当前实现对语料执行两次 256 条 keyset 分页扫描：一次汇总 BM25 语料统计，另一次评分排序；另有已配置 Dense 向量时的分页读取和应用层向量评分。Chunk 数为 N 时，BM25 读取和打分随 N 线性增长，数据库分页请求量约为 `2 × ceil(N/256)`，外加连接往返和 JSON 文本/向量反序列化。

在无并行训练负载的本机 Node 22.22.2、隔离 PostgreSQL 18.6 上，用 5,000 个合成 Chunk、5 个英文及 5 个中文固定查询、每条查询 5 次比较：

- 当前 BM25 两次扫描：目标 Chunk Recall@8 为 10/10；查询 p50 `128.86 ms`、p95 `135.44 ms`；Node 进程采样 RSS 增量 p95 为 `7,159,808` 字节；没有额外应用索引空间。
- 临时 PostgreSQL `simple` 全文检索 + GIN：目标 Recall@8 为 4/10；查询 p50 `0.19 ms`、p95 `0.41 ms`；PostgreSQL 测得临时表 `1,368,064` 字节、GIN 索引 `344,064` 字节。查询计划使用 Bitmap Index Scan。
- GIN 样例没有词干归一化或中文分词；漏掉 5 条中文目标及 1 条英文目标。它的速度优势不能抵消当前对照中的召回差异。
- RSS 是 Node 进程采样，不包含 PostgreSQL 后端内存；5 次重复和 10 个刻意构造查询不足以代表生产语料或并发负载。

本轮未切换检索架构：当前数据没有证明简单 FTS 可保持检索质量；若为找回漏召回而再执行 BM25 全扫描，主要扫描负载仍在。PostgreSQL 16 部署文档称 GIN 是其全文检索常用索引类型；这只支持实现可行性，不证明此项目迁移收益。[PostgreSQL FTS 索引文档](https://www.postgresql.org/docs/16/textsearch-indexes.html)

本环境只发现 `pg_trgm`，没有 `vector` 扩展，因此没有运行 pgvector 的实际对照。当前向量以 JSON 存储并应用层计算；引入 pgvector 需扩展可用性、类型迁移、重建索引和现有向量数据验证。没有实际大型语料/并发证据说明该改动当前必要。参见 [pgvector 项目说明](https://github.com/pgvector/pgvector)。

## 迁移外的代码和测试变更

- `e2e/durable-worker-runtime.spec.ts`：扩充真实 HTTP + Worker Mock 场景，覆盖多节点、人工介入、取消及 Worker 重启。
- `e2e/durable-browser-recovery.spec.ts`：新增浏览器刷新与同一 Job 的 SSE 恢复场景。
- `scripts/acceptance/benchmark_rag_index.ts`：可复跑的合成 BM25 / PostgreSQL GIN 对照。
- `scripts/acceptance/evaluate_nfcorpus.py`：独立 NFCorpus 评测脚本，输出逐查询预测、指标和失败样例。
- `scripts/acceptance/answer_eval.py`、`test_answer_eval.py`：离线答案请求准备、人工标注计分和流程单测。
- `docs/phase6/`：本报告、AI 结果与部署就绪度结论。
- `docs/phase6/artifacts/nfcorpus/`：保存逐查询和失败样例评测产物；不包含原始 NFCorpus 数据或模型权重。

## 未验证事项

- 修复提交 `bb1aefd` 的远端 GitHub Actions：尚未验证；提交当前只在本地。
- 该 E2E 修复之后的远端 Playwright 和 Next.js Production build：尚未验证；本次构建因前序 E2E 失败而跳过。
- Vercel 检查虽为 success，但对应 Preview 还是 Production、实际流量目标和运行时 Worker 拓扑：尚未验证。
- 多实例、真实网络中断、跨机房恢复和生产负载：尚未验证。
- 真实模型生成答案、模型供应商 usage/费用、Single-Agent 与 Multi-Agent 答案支持性：尚未验证。
- RAG 大型真实论文库、并发吞吐及 pgvector：尚未验证。
- 本轮没有运行漏洞扫描、攻击模拟、渗透测试、权限/鉴权探测，也没有访问生产服务或真实用户文件。既有安全审计事项原样保留，不代表已经修复。
