# ScholarKernel 普通工程修复综合报告

日期：2026-10-30

本报告记录 Phase 0–F 普通工程修复的阶段性验收。之后继续完成的 SciFact 检索评测与独立 PyTorch Reranker 研究，以 `docs/upgrade/MASTER_REPORT.md` 及其 Phase 3/4 报告为当前升级总结；本文件保留原阶段结果和未验证事项，不作为 Phase 3/4 实验记录。

本报告中的环境限制和“尚未验证”描述表示当时阶段的检查状态。之后 Phase 2 已在全新隔离数据库部署全部 10 条迁移；当前隔离数据库 `scholar_upgrade` 的 `prisma migrate status` 显示数据库 schema up to date，`prisma migrate diff` 输出 empty migration。新的检索评测和训练事实以 Phase 3/4 文件为准。

分支：`fix/phase1-foundations`

仓库：`/Users/dingcs/Documents/Codex/2026-10-29/files-pasted-by-the-user-scholarkernel/outputs/ScholarKernel`

## 1. 修复前后的工程状态

审计报告记录的主要普通工程问题包括：PDF 原始字节解析可能不终止、压缩 PDF 提取为空；Prisma 迁移缺少运行必需的计费表；Agent 节点状态和失败结果不一致、并行评审检查点延迟；纯文本栏顺序被错误重排、页码被默认编造；Reranker 失败可能中断检索；输出 Token 配置未生效、模型流错误被吞掉；CI 缺少 TypeScript 和可选的 Playwright 门禁。

本轮已修复 PDF.js 解析、计费表迁移、Agent 状态和检查点、RAG 来源与页码处理、Reranker 降级、模型输出预算、模型流错误反馈、Agent 用量聚合、人工干预浏览器等待通道，并将这些功能加入普通工程门禁。迁移历史已由此前阶段在隔离 PostgreSQL 上验证；本轮新增的 `agentId` 迁移未能在本机完成隔离数据库复验，详见第 6 节。

## 2. 阶段修改和 Git Commit

| 阶段 | Commit | 修改文件与内容 |
|---|---|---|
| TypeScript 基础修复 | `c059db3` | `src/lib/learning-studio.ts` 与相关单元测试中的类型修复。 |
| PDF 解析 | `d6964d3` | `src/lib/document/pdf-text-extract.ts`、`layout-aware-parser.ts`、解析 API、Next tracing 配置和 PDF 生命周期/内容测试；升级 PDF.js，加入大小限制、超时、资源清理和清晰错误。 |
| A：Prisma 迁移 | `c6bfb39` | 新增 `UserBilling`、`TokenAuditLog` 迁移，CI 使用 `prisma migrate deploy`、重复迁移和 schema parity 检查。 |
| B：Agent 工作流 | `e5d4cb9` | `agent-executor.ts`、`agent-jobs.ts`、Job 创建/恢复 API、Planner、Peer Review 检查点及测试；持久化节点、部分结果和取消/失败状态。浏览器人工干预补充修复：`9306a98`，`src/components/human-intervention-panel.tsx` 优先唤醒本地等待中的 Gate，并保留服务端 API 路径。 |
| C：Academic RAG | `2b3054f` | `academic-semantic-chunker.ts`、`column-reorder.ts`、`rerank-gateway.ts`、`academic-search-strategy.ts`、Agent 来源映射和相应测试；无页码映射时保留未知，纯文本不猜栏序，来源 ID 跨批次统一。 |
| D：Token 和模型调用 | `555d084` | `llm-utils.ts`、Agent runners、计费桥接/聚合、`TokenAuditLog.agentId` 迁移及 Token、流、RAG 回归测试；落实 `maxOutputTokens`，移除搜索字符数到模型 Token 的伪计量。 |
| E：测试和 CI | `02ca1b3`, `a0aa5c6` | `package.json`、`.github/workflows/ci.yml`、`eslint.config.mjs`、`next.config.ts`、Playwright workspace 测试、`src/app/api/documents/parse/__tests__/route.test.ts` 和明确 UI lint 清理；CI 改用功能用例白名单并增加 E2E 与文档解析 API 测试。 |
| F：文档整理 | `b9fc436` | 更新 `README.md`、`.env.example`，新增架构说明、面试指南和本报告；九份已有审计 Markdown 保持原样并纳入文档提交。 |

## 3. 各阶段修复概要

### A：Prisma 数据库迁移

- 新增 `UserBilling`、`TokenAuditLog` 建表迁移，CI 不再以 `db push` 代替迁移历史。
- 此前阶段在全新隔离 PostgreSQL 上应用 4 个迁移；再次运行没有待处理迁移，schema diff 无差异。
- Agent 状态迁移在阶段 B 的隔离数据库上再验证：5 个迁移成功，重复执行无待处理迁移，schema diff 无差异。
- D 阶段新增 `TokenAuditLog.agentId` 及索引；因本机命令被平台拦截，尚未对包含这份新迁移的空数据库重新验证。

### B：Agent 工作流可靠性

- Executor 返回的节点状态与 hooks 更新同步；失败不再被总结成正常完成，取消有明确状态。
- 服务端 Job 持久化节点、部分结果、来源和 Peer Review 阶段，检查点写入排队并在终态前等待。
- 增加对 `cancelled`、`error`、`partial` Job 的恢复入口；已完成节点可跳过，剩余工作继续。
- Reviewer 单边完成即写检查点，另一边失败时仍保留成功结果。
- 普通浏览器人工干预现在可以直接唤醒浏览器中的等待 Promise；服务端等待仍走既有接口。

### C：Academic RAG

- 章节标题识别采用精确边界；长章节限制分块长度。
- 只有解析得到的真实页面块才写入页码；缺失映射保持未知。
- 纯文本缺少坐标时保留输入顺序；有 PDF 坐标时才执行左右栏读取。
- 搜索结果按规范化 URL 去重并统一引用编号；中文使用 bigram 排序。
- 外部 Reranker 结果校验失败或服务异常时回退到词项排序。

### D：Token 预算和模型调用

- 输出预算尊重用户设置（默认 1024，界面范围 1–8192），传给规划、推理、审稿、查询改写等生成调用。
- 统一设置 60 秒调用超时、AbortSignal 和一次 SDK 重试；输入 `contextLimit` 仍是字符级裁剪，并不冒充精确 Token 上限。
- 忽略 reasoning delta，传播模型流 error；失败信息包含已生成的部分文本，空文本会明确报错。
- Token 用量按 `planner`、`reasoning`、`peer_review` 等 Agent 归档；计费汇总使用供应商返回的 Token 数。
- 删除将检索摘要字符数换算成“模型 Token”的审计写入。成本仍由现有静态单价估算，不等同供应商账单。
- 同行评审上下文不再同时包含完整原稿和完整分块副本；推理不重复注入刚加入 session context 的同一批检索来源。

### E：测试与 CI

- CI 新增 TypeScript、限定范围的普通功能 Vitest、Agent Job 生命周期、ESLint、Playwright 和生产构建。
- Prisma CI 从空数据库迁移、重复迁移并检查 schema parity。
- Playwright 覆盖健康接口和聊天输入框草稿交互；Vitest 覆盖内存文本上传的文档解析 API；草稿测试不发送模型请求。
- `test:quality` 显式列出不触发身份认证、安全或外部模型测试的普通功能用例；Agent Job 测试过滤掉一个用户归属检查用例。

### F：工程文档

- README 改用迁移工作流，记录 PDF、RAG、预算和计费边界。
- `.env.example` 补充可选模型、搜索和 Reranker 环境变量示例。
- `docs/ARCHITECTURE.md` 说明当前组件、工作流、数据库、文档与限制；`docs/INTERVIEW_GUIDE.md` 给出项目讲解、追问和负责人需掌握的原理。
- 原有九份审计报告保持未修改并保留。

## 4. 实际执行的测试和检查

| 检查 | 结果 |
|---|---|
| PDF 专项测试 | 此前阶段 `pdf-parser` 与 `pdf-parser-lifecycle` 共 9 项通过。 |
| Agent 阶段 B 定向测试 | 此前阶段 4 个文件共 32 项通过。 |
| RAG 阶段 C 定向测试 | 此前阶段 6 个文件共 40 项通过。 |
| D 阶段 Token/RAG/Agent 定向测试 | 4 个文件共 32 项通过；覆盖 Agent 结果、预算、用量聚合、流错误和上下文裁剪。 |
| `npm run test:quality` | 22 个文件、119 项通过，含健康接口和 `/api/documents/parse` 的内存文本上传测试。 |
| `npm run test:workflow` | 8 项通过，1 项按范围跳过（测试 `getAgentJobForUser` 的用户归属筛选）。 |
| Playwright | 最终 2 项通过：`/api/health` 和聊天草稿交互。运行时清空模型密钥并指向无服务的本地数据库地址；聊天页的数据 hydration 请求因此得到预期 `ECONNREFUSED`，本次 E2E 不验证数据库数据加载。 |
| `npx tsc --noEmit` | 通过。D 阶段和最终代码变更后均通过。 |
| `npm run lint` | 退出码 0、0 errors、2 warnings。剩余 warning 是 `src/lib/auth-user.ts` 与 `src/lib/session-auth.ts` 中未使用的 `_req` 参数。审计 evidence 下的 probe 脚本从 lint 输入排除，文件保持未修改、未执行。 |
| `npm run build` | 通过。Next.js 报两个警告：middleware 文件约定将弃用；`/api/source` 的动态文件路径触发 Turbopack NFT 全项目 tracing 提示。前者属于 middleware/auth 路径，后者涉及文件读取边界，本轮未改动。 |
| `git diff --check` | D、E 阶段通过；最终提交前再次运行。 |
| 隔离迁移验证 | A、B 的全新数据库验证通过。D 阶段新加迁移的复验未执行，原因见下一节。 |

`npm test` 全量套件未运行，因为仓库全量测试包含 middleware/session authentication、未认证 API 和用户归属检查等用例；本轮按明确授权使用了功能测试白名单。真实 Provider API、生产服务、真实用户文件和生产数据库均未访问。GitHub 上的 CI 工作流更新尚未触发。

## 5. 失败测试与环境限制

- Playwright 第一次执行时本机没有当前 Playwright 版本要求的 Chromium；安装到仓库忽略的 `node_modules/.cache/ms-playwright` 后重跑通过。
- 随后的第一次 UI 用例因 Next dev origin 配置阻止 `127.0.0.1` HMR，页面停留在加载态；加入 `allowedDevOrigins` 后重跑通过。
- D 阶段隔离 PostgreSQL 复验命令被平台自动检查拒绝，原因是临时数据库清理 trap 中包含 `rm -rf`。按任务要求停止该受限操作，没有尝试通过替换清理方式继续执行。该拦截发生在命令启动前，所以不能把新迁移记为通过或失败，只能记为未验证。
- `npm run build` 与 E2E 的 Next.js 警告如上；构建本身通过。

## 6. 尚不支持或尚未验证

- 扫描版、纯页面图像 PDF 需要 OCR；ScholarKernel 当前不做 OCR。密码保护、损坏、空白或不支持的 PDF 不保证提取到正文，并会返回可读错误。
- 没有真实 Provider API Key 时，真实模型输出、供应商重试语义、真实用量和真实账单均未验证。展示成本只是静态价格表估算。
- `contextLimit` 按字符而非真实 Token 计算，且不能完全计入 system/tool schema 等所有供应商输入。
- 本报告撰写时，新增 `agentId` 迁移尚未完成本机重新验证；之后 Phase 2 已在全新隔离数据库验证全部 10 条迁移及 schema parity。当前 CI 远端运行仍未触发。
- 普通聊天 UI 仍在浏览器执行部分 Agent 工作，而持久化恢复能力主要位于服务端 Job 路径；进程崩溃后的 `running` Job 也没有自动扫描接管。
- 本报告撰写时没有冻结检索评测。后续 Phase 3/4 加入 SciFact dev evidence retrieval 指标；该结果不覆盖本地用户文档、答案真实性或产品端成本，仍没有生产效果结论。
- 完整业务数据库浏览器流程未通过本机 Playwright 验证；本轮 UI E2E 只检查草稿输入，不点发送、不调用模型。

## 7. 未处理的安全审计事项

按任务范围，本轮没有运行安全测试、漏洞扫描、攻击模拟、认证测试、越权测试或生产数据探测，也没有修复审计中安全类发现。`docs/audit/technical-audit.md` 中仍需另行处理的项目包括：

- F01 匿名源码读取与隐藏文件访问边界。
- F02 消息全局 ID 更新的用户范围。
- F05 人工干预前的 Job 归属检查顺序。
- F15 日志中敏感搜索 Key 和原始上下文。
- F16 认证开关与代理行为。
- F17 可配置模型地址的服务器出站边界。
- F18 检索内容到工具调用的信任边界。
- F19 HTML 导出路径的清理。
- F20 依赖审计告警的可达性分级。

F12 也仍有普通架构差异：浏览器执行与服务端计费/检查点没有完全统一。此处只修复了浏览器内人工干预 Gate 无法由服务端进程唤醒的问题，没有改动 API 权限或认证逻辑。

## 8. 后续需要人工检查

1. 用新的隔离 PostgreSQL 实例运行包含 `20261030140000_agent_token_usage` 的全部迁移两次，并比较最终 schema；不要连接生产数据库。
2. 检查 CI 实际运行记录，尤其是 GitHub Actions Postgres、Playwright Chromium 安装和迁移 parity 步骤。
3. 决定是否将普通聊天 UI 迁移到服务端 Job 执行路径，并设计兼容的流式 UI、人工干预、用量记录和恢复体验。
4. 若要声称 ScholarKernel 用户文档 RAG 质量提升，需建立相应的可复现语料与标注评估；SciFact dev 结果不能替代该验证。若要支持扫描 PDF，再单独设计 OCR 流程。
5. 在单独授权和计划下处理上述安全审计事项；这些事项不应被本报告的工程修复结论覆盖。

## 9. 是否适合作为 AI/LLM 实习代表项目

**适合以“AI/LLM 工程原型”身份展示，不适合描述为生产就绪或已证明高学术准确率的系统。** 它能够展示 Agent 工作流、RAG 数据处理、模型调用、用量记录、Prisma 迁移和可靠性测试等实际工程内容。面试中应主动讲明 OCR 缺失、浏览器与服务端 Job 分离、静态成本估算、真实模型未验证以及尚存的安全审计事项；不要编造模型准确率、性能提升百分比或生产经验。
