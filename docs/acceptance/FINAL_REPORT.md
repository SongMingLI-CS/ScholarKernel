# ScholarKernel 2.0 工程验收与缺口修复报告

日期：2026-10-30。工作分支：`fix/phase5-acceptance`。基线为远端确认的 `71bc1fe1dd65d906e892f05aaf2bdd5f194f5ca9`。本地修改按阶段提交；没有推送、合并或部署。

## 结论

完成 Phase 5.1–5.6 范围内可在本机验证的普通工程工作：空 PostgreSQL 迁移、服务端 Agent Worker 闭环、去除 RAG 的 1,000 chunk 截断、SciFact 结果独立复算、固定引用支持评测输入，以及复现/限制/面试文档。主应用类型检查、lint、常规功能测试、生产构建和四条 Playwright 用例通过。

系统适合以**有检索实验支撑的 AI/LLM 工程原型**用于实习面试；目前没有证据称它生产就绪、生成答案准确、普遍优于基线或适用于用户上传 PDF 的科研结论。回答支持性和 Agent 单/多智能体效果尚未实测。SciFact dev 被用于 epoch 选择，无独立 test；RAG 性能只在本机合成数据测到 5,000 chunks。安全审计未复核，既有安全审计事项保持未处理状态。

## 阶段验收矩阵

| 能力 | 状态 | 本轮证据与边界 |
|---|---|---|
| 远端 CI 与触发条件 | 配置完成，远端未验证 | 已确认基线 SHA 没有 GitHub Actions run；新增 fix 分支触发和本地 Mock Worker 浏览器配置。未推送，所以新工作流没有远端执行证据。 |
| Prisma 迁移 | 完成且验证 | 全新隔离 UTF-8 PostgreSQL 18.6 应用 10 条 migration（CI/Compose 配置为 16，尚无该环境运行证据）；第二次无待处理迁移；schema diff 空；隔离数据库用例通过。未连接真实/共享数据库。 |
| Agent 持久化执行 | 完成且功能验证 | Job 生命周期 10 项、Route/Worker/文档集成组合 17 项通过；实际 Next HTTP + 独立 Worker + 本地 Mock API 工作流 E2E 通过。前端刷新 Playwright 用例仍 mock API。 |
| PDF 解析 | 完成且功能回归通过 | `test:quality` 中 parser 与 lifecycle 9 项通过，单栏/双栏、压缩流、空白文档、超时和资源释放已有回归。扫描 PDF/OCR 不支持。 |
| Academic RAG 完整性 | 完成且功能验证 | 分页检索在 1,305 chunks 命中最后一条中文证据；文档更新清除旧 chunk；RAG、reranker、来源映射用例通过。没有 pgvector，搜索仍扫描全语料。 |
| RAG 容量测量 | 完成但限于合成环境 | 本机 PostgreSQL + Node 22，100/1,000/5,000 合成 chunks，每档 5 次。5,000 查询 p50 80.45ms、p95 87.75ms；不外推生产或更大语料。 |
| SciFact 研究复核 | 完成但属探索性 dev 结果 | hash 与 checkpoint hash 一致；五个系统 1,500 行逐 query metrics 零差异；两种 reranker 候选集合一致；bootstrap 见第 04 阶段。无独立 test、多 seed 或新训练。 |
| 答案引用支持评测 | 框架已完成，效果未验证 | 固定 10 条任务输入及标注协议已提交；没有生成答案、真实模型对照或答案支持率结果。 |
| Token 预算与账单 | 功能测试通过，真实调用未验证 | Token budget 8 项、billing metrics 1 项等通过；真实 provider token、费用和账单未验证。上下文限制仍按字符近似。 |
| 常规工程质量 | 完成且验证 | TSC、ESLint、`test:quality`、工作流测试、Next.js build 均通过；Playwright 使用本机 Chrome 全部 4 项通过。build 有 middleware 弃用提示，浏览器有 React Flow 重建提示。 |
| Docker/部署 | 配置已检查，部署未执行 | Compose 配置及 server 构建参数解析通过，runner 文件布局下 Worker 启停通过；Docker daemon 不可用，未构建/启动镜像、未部署。 |
| 安全审计 | 未处理、未验证 | 本轮没有漏洞扫描、渗透、攻击模拟、认证/权限测试。保留既有 `docs/audit/` 材料，不把普通工程验收解释为安全合格。 |

## 修改文件

### Phase 5.1：CI、迁移与部署

- `.github/workflows/ci.yml`：fix 分支触发与 durable Worker Mock E2E 环境。
- `docker-compose.yml`、`Dockerfile`：增加可选 `durable-agent` profile Worker；补齐 runner 的 Worker 源码/路径配置，以及客户端执行模式的构建参数。
- `.env.example`、`README.md`：补充 Compose PostgreSQL / Worker 配置与使用说明。
- `docs/acceptance/01-engineering.md`：远端状态、隔离迁移和部署拓扑证据。

### Phase 5.2：Agent 执行闭环

- `src/lib/__tests__/agent-runtime.integration.test.ts`：Route Handler、Worker、数据库和本地 Mock 的持久聊天集成。
- `e2e/durable-worker-runtime.spec.ts`：Next HTTP + 独立 Worker + 本地 OpenAI-compatible Mock 的聊天和 Planner→Executor 工作流 E2E。
- `package.json`、`.github/workflows/ci.yml`：加入运行入口与本地 fixture 设置。
- `docs/acceptance/02-agent-runtime.md`：记录执行链路、恢复和 at-least-once 边界。

### Phase 5.3：Academic RAG

- `src/lib/document/search-conversation-chunks.ts`：256 行 keyset 分页、完整 BM25 语料统计、Dense 分页评分和阶段耗时采样。
- `src/lib/document/rerank-gateway.ts`：支持 query term 的分批 BM25 文档频率/平均长度统计及统一评分。
- `src/lib/__tests__/document-index.integration.test.ts`、`src/lib/__tests__/rerank-gateway.test.ts`：大于旧上限、合成容量及分页 BM25 等价回归。
- `docs/acceptance/03-academic-rag.md`：性能读数、限制及测试证据。

### Phase 5.4：ML 研究复核

- `scripts/acceptance/recompute_scifact_evaluation.py`：标准库独立复算指标、校验 hash/候选池、近重复统计和配对 bootstrap。
- `docs/acceptance/04-ml-reproducibility.md`：训练/数据/权重核查、复算结果与评估限制。独立的 `ScholarKernel-reranker` checkout 未修改。

### Phase 5.5：答案/Agent 评测准备

- `docs/acceptance/fixtures/citation-support-v1.jsonl`、同目录 `README.md`：10 条带溯源的 SciFact 支持/反驳任务。
- `docs/acceptance/05-ai-evaluation.md`：Citation Support 指标协议、Agent 对照和消融计划。

### Phase 5.6：最终文档

- `docs/acceptance/FINAL_REPORT.md`、`REPRODUCTION.md`、`KNOWN_LIMITATIONS.md`、`INTERVIEW_GUIDE.md`。
- `docs/ARCHITECTURE.md`、`docs/upgrade/ARCHITECTURE.md`、`README.md`：更新分页 RAG 行为与当前验收文档入口。

此前 `fix/phase1-foundations` 上的 TypeScript/PDF 修复、九份审计材料及已有未跟踪 `docs/audit/delivery-manifest.json`、`docs/audit/evidence/` 均保留。后两者未纳入本轮提交。

## 实际验证结果

- `npx tsc --noEmit`：通过；Next.js production build 也完成 TypeScript 阶段。
- `npm run lint`：通过。
- `npm run test:quality`：24 个文件，135 项通过。
- `npm run test:workflow`：8 项通过、1 项按既定名称过滤跳过；被跳过的 `scopes by userId` 未运行。
- 隔离 PostgreSQL 集成：4 个文件 / 17 项通过，其中 durable Job 10 项、文档索引 5 项、Worker/chat 集成 2 项。
- RAG/reranker/search strategy：3 个文件 / 35 项通过。
- `npm run test:e2e`：使用 `PLAYWRIGHT_CHANNEL=chrome` 和隔离数据库，4 项通过。最初默认 Playwright Chromium revision 不在本机时，两条需要浏览器的用例无法启动；改用本机已安装 Chrome 后，整套四项通过。没有访问外部模型 API。
- `npm run build`：通过；Next.js 16 显示 `middleware` 命名约定弃用警告。未改动 middleware/auth 边界。
- Python 研究单测：5 项通过。
- `scripts/acceptance/recompute_scifact_evaluation.py ../ScholarKernel-reranker`：数据文件与归档 hash 全匹配；checkpoint SHA 匹配；五系统对照官方 claim/qrels/corpus 无缺失、重复或错误映射，预测指标复算一致；300/300 reranker 候选集合相同。
- 本机 checkpoint 离线加载及 1 个合成 pair 前向：通过，输出有限分数；没有从头训练。
- fixture 源句、claim ID、source ID 映射校验：10 条全部通过。
- Prisma：空隔离库部署 10 个 migration，重复部署无待处理，schema diff 为空。
- Compose 配置（含 durable-agent profile）与 `NEXT_PUBLIC_AGENT_EXECUTION=server` 两服务构建参数解析通过；模拟 runner 文件布局的 production Worker 对隔离库轮询并收到 SIGTERM 后退出 0。Docker daemon 不可用，未构建镜像。

没有运行全量 Vitest、包含 `boundaries.integration.test.ts` 的 `test:upgrade`、真实外部模型/供应商调用、远端 GitHub Actions、从头 ML 训练、独立测试集、真实用户 PDF、生产服务或部署。具体复现步骤见 `REPRODUCTION.md`；所有边界见 `KNOWN_LIMITATIONS.md`。

## 阶段提交

| 阶段 | 本地 commit |
|---|---|
| 5.1 CI/部署/迁移（含文档校正） | `f5c9ee6e7a81809312e6bfe2cbc1965e7274f0c6`，`07f0148ef1bd7422188677ecb658380350253971`，`d1be43b9f683ebedc8667636f370f26be5a806af` |
| 5.2 Agent 闭环/浏览器 fixture | `e92f3849631ee82c8216617b43ffef13e7cc438e`，`da1912cb2b6558339db2a0fa844a8a76721e61b3` |
| 5.3 分页 RAG | `d1fb121eb74a3951c36d251eb060e893d6bb0518` |
| 5.4 SciFact 复核 | `ea663650fdc5b03f8f969bc0aad6a0a98c493e0f`，`de9df8d3d16dabd3739646c4e36a62d8e989d17a` |
| 5.5 引用评测准备 | `bc078957782c72113efdb4ac0814819f8a14c698` |
| 5.6 最终交付文档 | 本报告所在 commit 的 SHA 在最终 Git 历史/交付回复中列出，避免在提交中自引用。 |

## 后续人工检查

- 在可用 Docker/CI 环境核验 Node 20 + PostgreSQL 16 与真实镜像启动，确认 Web、Worker、SSE 和本地模型网络拓扑。
- 冻结独立检索 test 和更多随机种子，人工审查近重复 claim 分组。
- 有模型预算后生成固定任务集答案，由标注者核对证据支持与 Agent 对照；记录真实 usage/费用。
- 公开部署前另行授权安全审计及运维验收。

## 最终 Git 与安全边界

本轮临时 PostgreSQL 已正常停止，数据目录保留。`git diff --check` 通过。工作分支为 `fix/phase5-acceptance`，从确认的 `71bc1fe` 基线建立。提交后保留此前已有的 `docs/audit/delivery-manifest.json` 和 `docs/audit/evidence/` 未跟踪，不覆盖或删除。所有阶段仅在本机提交；没有推送、合并或部署。安全审计记录保持原状，本轮未执行安全验证；这不能解释为相关安全事项已修复。
