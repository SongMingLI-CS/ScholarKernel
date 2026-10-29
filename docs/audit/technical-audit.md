# ScholarKernel 技术审计

审计基线：`e129eb65e6bcbf6c2df9696c282613a557b672f1`，`main` 的独立浅克隆。执行日期：2026-10-29，Asia/Shanghai。结论仅针对这个提交；未访问线上实例，未修改原有业务源码、测试或迁移，未接触生产数据库。

## 1. 结论与证据边界

项目属于**有一定实现规模的 LLM 应用工程原型**。模型接入、流式输出、学术搜索、角色评审、会话存储均有实际代码；但恢复能力、租户隔离、文档解析和效果评测仍有影响核心可信度的问题。目前不能据此宣称生产就绪、具备可靠学术 RAG，或多智能体优于单智能体。

全量遍历了 228 个受 Git 跟踪的 UTF-8 文本文件，建立文件哈希、行数和源码导入索引；其中 136 个非测试 `src/` 文件、50 个单元测试文件及 1 个 E2E 文件。48,113 行包含锁文件，不等于业务代码行数。深读了 API、鉴权、Planner、Executor、同行评审、文件解析、搜索/重排、计费、持久化及部署路径；外围 UI 以职责、依赖、状态连接检查为主。全量索引不等于对每行代码的形式验证。

证据入口：[源码目录](evidence/source-index.md)、[测试结果](verified-test-results.md)、[全部执行记录](evidence/check-manifest.json)。证据级别：

- **实测**：执行当前源码或真实本地 HTTP/数据库，观察到结果。
- **受控验证**：模型、身份或流事件使用合成替身（Mock/Stub）；验证程序行为，不代表真实 AI 效果。
- **静态确认**：调用链明确，但未执行完整用户流程。
- **未验证**：需外部服务、真实语料、浏览器或故障注入，当前不能判断最终结果。

## 2. 已复现的优先问题

### F01 / P0：匿名源码读取没有鉴权，隐藏文件未被禁止

证据：`src/app/api/source/route.ts:7-36`；`src/middleware.ts:53` 的 matcher 不覆盖 `/api/source`。路径检查只拒绝部分相对穿越、绝对路径和 node_modules，没有文件白名单、隐藏文件检查或真实路径校验。

调用链：匿名 HTTP GET → `GET` → `path.join(process.cwd(), rel)` → `fs.readFile`。在**已设置登录密码**的本地生产进程中，匿名请求合成隐藏文件仍返回 200，合成哨兵内容完整返回。同一进程访问会话/设置则是 401。[HTTP 证据](evidence/logs/http-probe.log)

触发条件：服务可访问，且工作目录有可读文件；若工作目录存在 `.env` 或日志，可被该接口读取。没有读取任何真实密钥文件；真实生产泄露事件未验证。符号链接（symlink）绕过边界是静态风险，未实施外部文件读取验证。

复现：仅在隔离环境运行 `node docs/audit/evidence/probes/http-probe.cjs`（需按测试报告启动本地服务），脚本创建并删除合成哨兵。修复方向：移除公开通用文件接口，或鉴权并限定专用目录、`realpath` 边界及可读文件类型。

### F02 / P0：消息全局 ID 的 Upsert 可覆盖其他租户消息

证据：`src/app/api/conversations/[id]/messages/route.ts:22-49`。先确认 URL 中的会话归当前用户，再用请求体 `id` 执行全局消息 Upsert（更新或插入），更新分支没有约束 `conversationId`。

触发条件：A 有自己的会话，并知道 B 的消息 ID。实际用两个合成用户和真实 PostgreSQL，身份解析替换成 A，调用真实路由；提交 B 消息 ID 后返回 201，B 消息内容被改写，仍属于 B 的会话。[复现结果](evidence/logs/audit-probes.log)

这是对象级授权缺失（Broken Object Level Authorization，BOLA），不是对随机 ID 可猜测性的断言。修复方向：将消息 ID、会话 ID 和用户所有权同时纳入更新条件，对已存在但不属于目标会话的 ID 返回 404/409。事务不能替代授权。

### F03 / P0：合法未压缩 PDF 触发同步循环；压缩 PDF 解析为空

证据：`src/lib/document/pdf-text-extract.ts:54-125`。在 `Tm`、`Td`、`Tj`、`TJ` 分支中回退索引，尤其 `Tj` 的 `i -= 1`（第 99 行）与 for 的 `i++` 抵消，反复处理同一个操作符；`Td` 回退也会重新到达自身。

使用脚本生成带 xref、Catalog、Page、Font 和 Contents 的合法单页 PDF。593 字节未压缩 PDF 的内容流含 `72 720 Td (AUDIT_PDF_SENTINEL) Tj`，解析进入后在 2 秒硬超时被终止。**未把它称为真实论文吞吐/延迟测量**。

同一文档使用 `/Filter /FlateDecode` 压缩，622 字节，返回空文本、0 个块。第 55-60、69-71 行直接把 PDF 字节当 Latin-1 文本并正则提取 stream，没有解压 Filter、对象引用解析和字体映射。`page += 1` 按内容流计数，不能代表真实页码。[PDF 脚本](evidence/probes/pdf-probe.cjs)、[输出](evidence/logs/pdf-probe.log)

调用链：匿名上传 → `/api/documents/parse` → `parseLayoutAwareDocument` → 同步 PDF 解析。解析 API 仅在 `formData()` 完成后检查 8 MiB，未鉴权、未隔离 CPU、未设置解析期限。循环会阻塞所在 Node.js 事件循环；未对在线服务发起阻塞或压力攻击。需先加受限解析进程/Worker、超时与健壮解析器，再谈版面质量。

### F04 / P0：迁移成功，但缺少两张运行必需表

`prisma/schema.prisma:138-164` 定义 `UserBilling`、`TokenAuditLog`，现有三份 SQL 迁移没有创建它们。独立 PostgreSQL 18.6 数据库执行 `npm run db:migrate` 返回 0；随后 `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` 返回 2，明确列出缺表。

真实登录成功后，`GET /api/user/billing-metrics` 返回 500；服务日志为 Prisma `P2021` / `UserBilling` 不存在。Agent API 的配额检查也依赖该表，会在执行前失败。第二个独立空数据库执行 `prisma db push` 成功，说明 CI 的 schema 同步会掩盖生产 migrate 路径缺口。Docker 启动用 migrate deploy，不能用 CI 的 db push 成功替代部署验证。

### F05 / P0：人工干预先影响等待任务，后验证 Job 归属

证据：`src/app/api/agent/intervention/route.ts:61-68`；`src/lib/agent/human-intervention-gate.ts:22-81`。等待 Map 只有 sessionId，没有 userId。POST 先 resolve，之后才在可选 `jobId` 分支查询用户归属；GET 也未检查 sessionId 的归属，传入 nodeId 未与真实等待节点匹配。

合成等待任务被 redirect 后，即使 Job 查找失败返回 404，等待 Promise 已收到 redirect。身份使用受控替身、Job 查询使用真实本地数据库。攻击需要知道有效 sessionId 且请求能通过路由鉴权；未验证 ID 泄露渠道。修复必须在 resolve 前绑定并校验 userId、jobId、nodeId，禁止客户端提供任意完整拓扑。

### F06 / P1：节点失败可变成正常返回，结果节点状态仍是 pending

`src/lib/agent-executor.ts:594-1011` 仅通过 hooks 发出节点状态，没有同步修改返回的 nodes；节点异常加入 results 后继续，最后正常 return。实际 SDK + 本地 HTTP 模型替身执行成功，hooks 出现 running/done，但返回节点仍 pending。单节点 peer_review 失败也正常返回“ERR”摘要；`src/app/api/agent/jobs/route.ts:124` 随后会无条件 complete Job。

这是执行成功率（Execution Success Rate）定义失真，影响界面、持久化与评测。已有实测证明执行器行为；“所有失败组合均被标 done”的完整 HTTP Job 验证未执行。建议返回结构化 runStatus/stepResults，区分 done、partial、failed、cancelled。

### F07 / P1：RAG 页码和顺序存在确定性错误

`academic-semantic-chunker.ts:74-85,167-168`：`inferPageForText` 默认返回 1，使后面的 `?? estimatePageFromOffset` 无法作为未知页码兜底。无任何页信息的两个章节都标成 p.1，已复现。

`column-reorder.ts:130-161`：8 行以上、短行占多数且奇偶长度接近，就按奇数行后偶数行拼接。普通单栏八句被打乱为 1,3,5,7,2,4,6,8，已复现。不能把人工构造交错 L/R 行测试通过，解释为真实双栏 PDF 准确。

### F08 / P1：预算与上下文不是可靠的资源约束

`llm-utils.ts:70-73` 将用户配置的 512 输出 Token 提高到至少 8192；本地 HTTP 模型替身观察到实际 `max_tokens=8192`，规划请求则没有输出上限。`serializeSubtaskForReasoning:603` 只保留读取文件前 500 字符，关键内容在末尾时丢失，已受控验证。

`peer-review-runner.ts:102` 给长投稿附加完整章节切片，原文也保留，存在重复上下文。`reasoning-runner.ts:162` 又加入子任务 JSON，研究结果还作为 assistant 历史注入。`contextLimit` 按字符处理、未计完整 system/tool schema 和实际分词 Token；不是模型上下文窗口的硬限制。

### F09 / P1：流中的错误事件被吞掉

`llm-utils.ts:111-131` 对 `type: error` 仅警告后继续，`reasoning-delta` 也拼入用户正文；函数可正常返回部分/空文本，调用方随后标 done。受控流 `text-delta('partial') → error` 实际返回 partial。真实各模型供应商的错误流行为未验证。需区分推理片段与正文、传播终止错误，并保留 partial 标记。

### F10 / P1：并行审稿的单边成功没有及时持久化

`peer-review-runner.ts:355-374` 先 await `Promise.all`，两边都成功后才写各自检查点。R1 完成而 R2 抛错时，onCheckpoint 0 次，已受控复现。重试将重复调用已完成的 R1。每个分支应完成即持久化，并定义并行取消及幂等键（Idempotency Key）。

### F11 / P1：TypeScript 和 E2E 门禁不足

独立 `tsc --noEmit --incremental false` 失败，8 条错误主要位于测试。Next 16.2.4 的本地 `runTypeCheck.js:114-121` 过滤测试文件诊断，解释了 build 可通过、tsc 失败，并非随机矛盾。

Playwright 只含 `e2e/health.spec.ts:3-8`，使用 request fixture 验证健康接口；归类为**端到端测试（End-to-End Testing，E2E）覆盖不足**。没有验证浏览器登录、上传、聊天、停止、断点恢复、人工干预或多用户隔离。

## 3. 静态确认的架构缺口与未验证风险

### F12 / P1：浏览器执行与服务端人工干预/计费分离

`src/hooks/use-chat-send.ts:219-373` 在浏览器 new AgentExecutor；未注入 userId、recordTokenUsage、jobId 或检查点回调。等待 Map 因而在浏览器。`human-intervention-panel.tsx:45` 却 POST 服务端，服务端不共享该 Map。所有带 sessionId 的正常同行评审默认都会等人工批准（`peer-review-score-gap.ts:46`），不是只有分数冲突才暂停。

因此普通浏览器路径存在等待无法解除的明确调用链缺口，也不经过服务端 quota gate。代码连接关系已确认；完整真实模型浏览器 E2E 未执行，不声称观察到实际用户超时。正常浏览器搜索重排也无法直接读取服务端 `COHERE_API_KEY/RERANK_API_URL`，必须说明执行位置。

### F13 / P1：有检查点能力，但没有完整可达的恢复入口

`jobs/route.ts:55` 总是创建新 Job；`jobs/[id]` 只支持 GET；未找到恢复旧 Job 的 API/worker。`failAgentJob(...,{phase:'error'})` 会覆盖旧 checkpoint，complete 也替换快照。异步 `void update...` 不排队，`nodes:[{id,patch}]` 覆盖整图，可能晚写覆盖完成状态。`persistAgentJobError` 找不到指定 Job 时还会选择“最新活动任务”，并发时可能误归因。

模块可以手工传入 PeerReviewCheckpoint 跳过阶段，已有 Mock 测试；不能称为重启后自动恢复。数据库写入乱序、跨进程故障与多副本路由未做真实故障注入。

### F14 / P1：外部重排/解析缺少超时和健壮降级

`document/rerank-gateway.ts:65,93,150` 与 `layout-aware-parser.ts:70-80` 的 fetch 没有 timeout/signal。HTTP 非 2xx 可能降级，但抛出的网络异常不等价于返回 null，可能中断整个搜索。未验证外部服务挂起。重排结果未校验索引范围、去重、有限分数和完整性；中文分词仅按空格，已观察相关与无关中文文档均为零分。

### F15 / P0（公开部署条件）：日志包含搜索 Key 与原始敏感上下文

`tools/search-tool.ts:205-217` 将含 `api_key` 的 Tavily 请求体完整 console.log；第 234 行还输出完整搜索响应。`agent-executor.ts:330,580` 输出模型计划/用户输入。源码行为明确，未向真实搜索服务发送 Key。`agent-job-errors.ts` 的局部脱敏不覆盖这些 console 路径。需在启用真实 Key 前删除敏感字段日志或使用统一结构化脱敏。

### F16 / P0（公开部署条件）：认证开关和代理行为不一致

`session-auth.ts:31`、`middleware-auth.ts:15` 只依据 AUTH_PASSWORD；`auth.ts:14,54` 又支持 GitHub OAuth。仅配置 OAuth 而不配密码时，API 解析退回公共 `default_user_id`，多用户隔离失效；完整 OAuth 登录未执行。

`proxy-gateway.ts:81-88` 未设置 PROXY_ACCESS_TOKEN 时即使 production 也放行；现有测试甚至明确断言此行为。受控验证已确认放行分支。代理仅到固定供应商且需上游 Key，不能直接推断“匿名消耗服务器模型 Key”。限流依赖客户端转发 IP 和进程 Map，没有过期清理/共享存储，需可信代理边界。

代理访问 Token 与上游 Bearer Key 还可能混用：`proxy-client.ts:25` 只在无 Authorization 时写代理 Token；有上游 Bearer 时不写独立 token 头，导致受保护代理鉴权失败。完整真实供应商浏览器验证未执行。

### F17 / P1：可配置模型地址缺少服务器出站边界

`agent/run/route.ts:20-24` 只检查 providerId/model 为字符串，baseUrl 未校验；`llm-utils.ts:618-644` 直接传给 SDK。本地 HTTP 替身证明执行器能向 loopback 地址发请求。服务器端请求伪造（Server-Side Request Forgery，SSRF）的配置面存在；未扫描私网、云元数据或第三方主机。真实 API 端到端利用、重定向和 DNS 变化未验证。建议服务器管理可用地址/模型，限制 URL、IP、协议和重定向，保留显式本机开发例外。

### F18 / P1：检索内容可影响工具，缺少代码级信任边界

检索文本、附件进入 Prompt，reasoning 同时拥有本地文件读取和外部搜索工具，主要依靠 system prompt 约束。文件 reader 第 56-58 行没有路径约束，`../` 读取合成工作区外哨兵已复现。提示注入（Prompt Injection）是否实际驱动某模型泄露文件未验证；需要将不可信材料视为数据，按最小权限授予工具，不能仅靠“严禁”提示。

### F19 / P1：HTML 导出有未清洗路径

`markdown-bridge.ts:43` 直接 marked.parse；`export-utils.ts` 将其结果赋给挂到 document 的 host.innerHTML。聊天 ReactMarkdown 路径没有启用 raw HTML，不能把两条路径混同。HTML 导出事件属性、危险 URL 的跨站脚本（Cross-Site Scripting，XSS）风险需浏览器沙箱验证；本次未执行脚本载荷，不下“已完成 XSS 利用”结论。

### F20 / P1：依赖审计告警未做可达性分级

本次 `npm audit --json` 报告 81 个依赖级告警：12 low、38 moderate、23 high、8 critical，包含直接与传递、生产与开发依赖。这**不是 81 个已证明可利用漏洞**。完整原始结果在证据目录；Next/Auth 等需按官方公告匹配使用特性再升级，不能盲目执行 `npm audit fix --force`。未执行漏洞利用验证。

## 4. 已存在且值得保留的实现

1. 模拟同行评审有真实并行 R1/R2、独立中间输出、顺序 debate/汇总逻辑，不只是 UI 动画；但角色基于 Prompt，共享基础模型，效果优越性未证明。
2. 会话、文档、设置和 Job 有 Prisma 模型；多数会话/文档查询有用户归属过滤，消息写入和计费事务有明确实现。不能因 F02 否定所有隔离代码，也不能因存在事务认定授权正确。
3. 服务端 Key 用 AES-256-GCM、随机 IV、scrypt 派生；生产缺 secret 有 fail-fast。浏览器持久化明确排除 runtimeKeys/workflow。设置 API 返回当前用户解密后的 Key 是现有设计，需准确告知用户服务端可解密，不是端到端加密。
4. 搜索有 URL 去重、学术域名过滤、宽召回/重排接口、来源标题/URL 流转；这些是可继续改进的工程基础。

## 5. 总体建议

先完成文件与租户边界、PDF 解析隔离、迁移一致性及人工干预授权，再统一实际执行入口与状态机。随后建立冻结语料和人工标注评测，最后再考虑独立训练 Reranker。详细任务的修改位置、工作量、验收及面试价值见 [优化路线](optimization-roadmap.md)。本次没有进行任何业务修复。
