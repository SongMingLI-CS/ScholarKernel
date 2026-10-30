# ScholarKernel Phase 6 最终验收

日期：2026-10-31。分支：`phase6-final-reliability-ai-validation`。基线：`1d8e19da7da7bb4f6c94924e5172ecbfe85ffcb7`（`fix/phase5-acceptance`）。本轮保留基线成果，在独立分支追加验证与少量修复；没有推送、合并或部署。

## 结论摘要

| 项目 | 状态 | 证据边界 |
|---|---|---|
| 基线 GitHub Actions | **失败** | 精确基线 SHA 的远端记录真实失败；失败原因为 PDF.js 6 与 Node 20 API 不兼容。 |
| Node 22 CI 修复 | **尚未验证（远端）** | 本地工作流改为 Node 22，未推送，因此没有该修复的远端运行结果。 |
| 基线 PostgreSQL 16 / 原 10 条迁移 | **真实验证通过（基线 CI）** | 同一 Actions Job 中 PostgreSQL 16.15 健康，10 条迁移部署和 Schema Parity 步骤通过。 |
| 当前 11 条迁移 | **真实验证通过（隔离 PostgreSQL 18.6）** | 空库部署 11 条、重复部署无待处理迁移、Schema 与数据库 diff 为空；新增迁移尚未在 PG16 远端验证。 |
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

检查的 GitHub Actions 记录：[run 41091103185](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41091103185)，job `124184888677`，`push` 事件，分支 `fix/phase5-acceptance`，SHA 与本报告基线完全一致。

该 Job 使用 Node 20 和 PostgreSQL 16.15。数据库启动健康；Prisma 基线已有 10 条迁移，迁移部署、重复部署和 Schema Parity 阶段通过。`test:quality` 中 5 个 PDF 测试失败，错误为 `Promise.withResolvers is not a function`：锁定的 `pdfjs-dist 6.4.299` 要求 Node `>=22.13.0 || >=24`。其余 23 个测试文件、130 项通过。后续集成/工作流测试、TypeScript、lint、Playwright 浏览器安装及 Next.js build 因失败而跳过。

本分支提交 `e0ef1b3` 将 CI 与 `package.json` engine floor 调整到 Node `>=22.13.0`，同时加入 TokenAuditLog 用量幂等键及去重写入。Node `v22.22.2` 本地验证可用，但没有远端执行记录。这个修复解决版本配置冲突的依据是错误信息与 PDF.js 的 Node 要求；**不能将其描述为远端 CI 已通过**。

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

- 本分支修改后的 GitHub Actions，以及新 migration 在 PostgreSQL 16 上运行：尚未验证。
- Vercel 报告成功对应 Preview 还是 Production、实际流量目标和运行时 Worker 拓扑：尚未验证。
- 多实例、真实网络中断、跨机房恢复和生产负载：尚未验证。
- 真实模型生成答案、模型供应商 usage/费用、Single-Agent 与 Multi-Agent 答案支持性：尚未验证。
- RAG 大型真实论文库、并发吞吐及 pgvector：尚未验证。
- 本轮没有运行漏洞扫描、攻击模拟、渗透测试、权限/鉴权探测，也没有访问生产服务或真实用户文件。既有安全审计事项原样保留，不代表已经修复。
