# ScholarKernel 真实测试与执行证据

基线：`e129eb65e6bcbf6c2df9696c282613a557b672f1`。执行日期：2026-10-29。所有结果来自已经完成的命令；本文编写阶段未重跑测试。原始输出保留在 [evidence/logs](evidence/logs/)，结构化命令、退出码、起始 UTC 时间和耗时见 [check-manifest.json](evidence/check-manifest.json)。

## 1. 环境和隔离

- macOS / Apple Silicon arm64；Node.js 22.22.2、npm 10.9.7、Prisma 7.8.0、Vitest 3.2.6、Next.js 16.2.4。
- 独立 Git 浅克隆；原有受跟踪文件没有改动。新材料只在 `docs/audit/`，中间文件在工作区 `work/`。
- 自建 PostgreSQL 18.6 集群，数据目录 `work/postgres-data`，只监听 127.0.0.1:55439。`scholarkernel_audit` 验证迁移；另建 `scholarkernel_schema_audit` 验证 schema push。没有生产连接串，没有删除任何生产数据。
- 本地生产服务监听 127.0.0.1:31417，使用合成密码和加密 secret。验证后 Next.js 和自建 PostgreSQL 均已停止，数据库文件和日志保留。
- 环境存在一项宿主 OpenAI Key，但未用于真实模型测试；已查看的现有测试相关外部调用使用 Mock，后续审计命令包装器主动移除 API Key 等环境变量。本轮没有执行真实付费模型、Tavily、Serper、Cohere、BGE 或外部版面服务测试。
- Docker 客户端存在，守护进程 socket 不存在。容器运行结果只能标“未执行 / 环境受限”。

## 2. 已有工程门禁

### T01 依赖安装：通过，有审计告警

命令：`npm ci`。退出 0，197.233 秒；postinstall 的 prisma generate 成功，安装 1,127 个包。访问 npm 注册表，属于真实网络依赖安装，不是 AI 服务调用。[安装日志](evidence/logs/install.log)

输出包含弃用警告和 81 个依赖级安全告警；后续 `npm audit --json` 退出 1，记录 12 low、38 moderate、23 high、8 critical。告警未逐项验证可达性，不等于应用存在同数量可利用问题。[审计输出](evidence/logs/npm-audit.log)

### T02 独立 TypeScript 检查：失败

命令：`npx --no-install tsc --noEmit --incremental false`。退出 2，5.295 秒，8 条错误：[完整输出](evidence/logs/typecheck.log)。

- `billing-system.test.ts:137`：usage 测试对象缺少 inputTokenDetails/outputTokenDetails。
- `crypto-server.test.ts:32,40,48`：给只读 NODE_ENV 赋值。
- `learning-studio.test.ts:11`：参数类型没有 content 字段。
- `peer-review-checkpoint.test.ts:65`：回调返回 push 的 number，契约要求 void/Promise<void>。
- `proxy-gateway.test.ts:19,44`：给只读 NODE_ENV 赋值。

没有修复、忽略或降低断言。Next 本地安装包的 `dist/lib/typescript/runTypeCheck.js:114-121` 会过滤测试文件诊断，故生产 build 成功不能代替全量 tsc。

### T03 ESLint：通过，8 个警告

命令：`npm run lint`。退出 0，5.781 秒。0 errors / 8 warnings，包括未使用变量和 React Hook 依赖提示。[日志](evidence/logs/lint.log)

### T04 Vitest：50 文件 / 243 测试通过

命令：`npm test`。退出 0，包装器耗时 3.254 秒，Vitest 报告 duration 2.76 秒。[日志](evidence/logs/vitest.log)

这是纯逻辑和受控替身（Mock）单元测试集合。API 多数 mock Prisma/身份；同行评审注入固定生成函数；计费并发测试操作 Map 和 mock transaction。不能把它们作为真实 PostgreSQL 并发、真实模型任务成功率或 RAG 检索准确率。

例如 `agent-executor.test.ts` 主要测 helper/分流/JSON 解析，并未执行真实完整 Agent；`agent-server-run.test.ts` 只测 Key 合并。`academic-rag.test.ts` 使用人工文本/坐标，最后上传样例是 `.txt`，并未证明 PDF 解析正确。

### T05 Next.js 生产构建：通过，存在警告

命令：`env DATABASE_URL=<本地隔离库> ENCRYPTION_SECRET=<合成值> npm run build`。退出 0，11.292 秒。[日志](evidence/logs/build.log)

prisma generate 和 Turbopack 构建成功，路由收集完成。警告包括 middleware 命名弃用、source API 的动态文件访问导致过宽文件追踪。没有真实模型调用。构建成功不验证数据库 schema 完整性。

### T06 Playwright：通过，但仅健康接口

命令：`env DATABASE_URL=<隔离库> ENCRYPTION_SECRET=<合成值> npm run test:e2e`。退出 0，6.497 秒；1 passed。[日志](evidence/logs/e2e.log)

唯一用例 `e2e/health.spec.ts:3` 用 request fixture GET `/api/health` 并检查 status。它没有打开和操作浏览器页面，未验证登录、聊天、上传、停止、恢复和人工干预。**分类：E2E 测试覆盖不足。** 不报告为“完整 E2E 通过”。

## 3. 数据库和服务运行

### T07 Prisma 迁移：命令通过，schema 完整性失败

命令：`DATABASE_URL=<scholarkernel_audit> DIRECT_URL=<同库> npm run db:migrate`。退出 0，1.128 秒，三份迁移成功应用。[迁移日志](evidence/logs/migrate.log)

紧接着执行 `npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`，退出 2，0.678 秒，列出缺少 UserBilling 和 TokenAuditLog。[差异日志](evidence/logs/migrate-diff.log)

因此结论必须分别写成“迁移执行成功”“迁移不能构建完整当前 schema”。

### T08 第二空库 db push：通过

命令：`DATABASE_URL=<scholarkernel_schema_audit> DIRECT_URL=<同库> npx --no-install prisma db push`。退出 0，0.739 秒。[日志](evidence/logs/schema-push.log)

该库与迁移库隔离，没有覆盖迁移结果。它只说明 CI 的 db push 可以建立当前 schema，不说明 migrations 正确。未继续开展新的数据库负载测试。

### T09 本地生产 HTTP：完成

启动：`npm start -- --hostname 127.0.0.1 --port 31417`，注入本地库及合成认证配置。服务 Ready，随后运行 `node docs/audit/evidence/probes/http-probe.cjs`，退出 0，0.424 秒。[HTTP 输出](evidence/logs/http-probe.log)

已有观察：健康 200；未登录 session 显示未认证；匿名 conversations/settings 返回 401；匿名读取合成隐藏文件返回 200；匿名 `.txt` 解析返回 200；合成密码登录 200 且有 Cookie；登录 settings 200；登录 billing-metrics 500。服务器原始日志明确为表不存在（P2021）。没有读取真实密钥或真实用户材料。

服务最后退出码 143 是审计人员对该验证服务发送 SIGTERM 的结果，**不是启动失败**。数据集群用 pg_ctl 正常停止，未删除。后续若重放需重新启动独立集群，不能使用生产库。

### T10 Docker：未完成，环境受限

`docker version` 无法连接 Docker daemon。`POSTGRES_PASSWORD=<合成值> docker compose config --quiet` 因克隆中不存在 `.env` 退出 1；这是缺少环境配置，不是已证明 Compose 语法错误。未创建真实 `.env`、未启动守护进程、未执行镜像构建，也未尝试规避环境或安全限制。[日志](evidence/logs/docker-compose-config.log)

## 4. 已完成的审计观察脚本

这些脚本位于 `docs/audit/evidence/probes/`，没有修改原有测试。**脚本 PASS 表示“观察到预期缺陷”，不表示应用安全或功能正确。** 不应直接把它们当修复后的绿色回归门禁。

### T11 11 项观察：完成

命令：`npx --no-install vitest run --config docs/audit/evidence/probes/audit.config.mjs`（当时目录仅含 audit.test.mjs），退出 0，0.837 秒。[日志](evidence/logs/audit-probes.log)

包括迁移缺表、真实数据库消息覆盖、合成文件读取边界、人工干预校验次序、页码默认 1、单栏重排、中文词项零分、输出预算提升、500 字符预览截断、错误流返回 partial、118 条离线路由回放。身份是 mock，文件/数据库操作为真实本地 IO，流是合成事件；没有外部模型调用。

### T12 实际 SDK + 本地模型 HTTP 替身：完成

命令：`npx --no-install vitest run --config docs/audit/evidence/probes/audit.config.mjs docs/audit/evidence/probes/stub-agent.test.mjs`。退出 0，1 用例，0.886 秒。[日志](evidence/logs/stub-agent.log)

真实 AgentExecutor 和 AI SDK 向本地 HTTP stub 发送两次 chat/completions：一次规划、一次流式推理。请求输出预算为 8192（配置为 512）；最终文本为固定 synthetic answer；hooks 为 running/done，返回节点仍 pending。这是传输与控制流验证，不是模型效果或服务延迟实验。

### T13 工作流 3 项观察：完成

命令：`npx --no-install vitest run --config docs/audit/evidence/probes/audit.config.mjs docs/audit/evidence/probes/workflow.test.mjs`。退出 0，1.049 秒。[日志](evidence/logs/workflow-probes.log)

确认：不完整 peer_review 组异常被转换成正常返回摘要；R1 完成/R2 失败时检查点回调 0 次；默认强制人工批准以及未配置 Token 的 production 代理放行。使用合成生成器/身份替身，不代表生产利用或真实评审。

### T14 PDF 有界子进程：完成，发现两类错误

命令：`node docs/audit/evidence/probes/pdf-probe.cjs`。退出 0，2.156 秒；脚本为子进程设置 2,000 ms 超时。[日志](evidence/logs/pdf-probe.log)

合法单页未压缩 PDF（593 字节）进入解析后不返回，被 SIGTERM 终止；同内容 FlateDecode PDF（622 字节）返回空文本。源码位置分别为 `pdf-text-extract.ts:84-109` 索引回退和 `:55-71` 对压缩流未解码。没有对真实服务发起 PDF 阻塞测试；详细条件见 [RAG 报告](rag-evaluation.md)。

## 5. 历史 Agent 数据与当前状态

历史 `agent-batch-1780341785874.json` 为 2026-06-01：118 条、84 条通过、34 条路由不符。已离线执行当前 `isDirectChatInput` 对历史输入分类，得到同样 84/118 与 direct_chat 16/48，当前路由与历史 actualRoute 无变化。[离线回放](evidence/current-route-replay.json)

这只复现了规则分类结果。**完整 118 条真实模型执行未执行**，当前答案质量、延迟、Token 和成本均未测量。当前批量脚本已将普通知识问答改为期望 workflow，且预检查要求标签等于同一个路由函数，不能据此得到独立路由准确率。

## 6. 未执行与待验证

- 真实 LLM、搜索、Cohere/BGE 和外部 PDF 解析服务：未执行，未使用真实 Key；不填造效果数据。
- Docker 构建/启动、Linux/Node 20/PostgreSQL 16 复核：环境受限，未执行。
- 多进程恢复、检查点写入乱序、并发超额、浏览器人工干预完整闭环：未完成验证。
- 真实论文 PDF 语料、引用与原文逐条对应、学术检索标准指标：未执行，缺冻结数据和标注。
- 进一步安全利用、攻击模拟或渗透测试：**受安全策略限制，未进一步验证**；保留既有证据，只提出防御性修复建议。

后续命令包装器已经加入默认 120 秒超时及仅终止自身进程组的处理；原有测试执行记录未回写超时字段，也未重跑。审计脚本为观察性材料，运行需人工确认独立测试库与合成数据；报告生成阶段不再执行它们。
