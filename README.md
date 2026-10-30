# ScholarKernel Web

ScholarKernel 的 Web 全栈客户端：对话式学术 Agent UI、多模型网关、本地会话持久化（Prisma + PostgreSQL）。

**产品主仓库**：[SongMingLI-CS/ScholarKernel](https://github.com/SongMingLI-CS/ScholarKernel)

## Docker 部署

```bash
cp .env.example .env
# 填写 POSTGRES_PASSWORD、DATABASE_URL、ENCRYPTION_SECRET、AUTH_PASSWORD 等生产变量
# DATABASE_URL=postgresql://scholarkernel:<POSTGRES_PASSWORD>@scholarkernel-db:5432/scholarkernel
# DIRECT_URL 与 DATABASE_URL 相同（用于迁移）

docker compose up --build -d
# 应用监听 http://localhost:3001
# PostgreSQL 数据持久化在 Docker volume `sk-postgres`
```

镜像启动时会自动执行 `prisma migrate deploy` 再 `npm start`。

默认 Compose 只启动 PostgreSQL 和 Next.js。需要服务端持久化 Agent 时，在 `.env` 中设置
`AGENT_DURABLE_JOBS=1` 与 `NEXT_PUBLIC_AGENT_EXECUTION=server`，然后通过 profile 启动独立 Worker：

```bash
docker compose --profile durable-agent up --build -d
```

Worker 等待数据库健康且 Web 完成迁移并健康后启动。关闭 profile 会保留仅 Web 的部署拓扑；
设置 `NEXT_PUBLIC_AGENT_EXECUTION` 后需要重新构建镜像。可选本地 Embedding/Reranker 服务不包含在
Compose 中，容器内的服务地址必须使用容器网络可达的地址，不能使用容器自身的 `127.0.0.1`。

## 开发

```bash
npm install
npm run db:migrate # 将仓库中的迁移应用到已配置的本地数据库
npm run dev        # http://localhost:3000
```

开发 schema 时使用 `npm run db:migrate:dev` 创建并应用迁移。部署使用 `npm run db:migrate`；不要用 `db push` 代替已提交的迁移历史。CI 从空 PostgreSQL 数据库执行迁移、重复执行迁移并比较 schema。

## 质量检查

```bash
npm run test:quality   # 普通功能测试白名单，不触发外部模型 API
npm run test:workflow # Agent Job 生命周期测试（跳过用户归属专项用例）
npm run test:e2e      # Playwright 浏览器测试
npx tsc --noEmit      # TypeScript
npm run lint       # ESLint
npm run build      # prisma generate + next build
```

`npm test` 运行 Vitest 全部测试；`test:quality` 是 CI 使用的普通功能测试集合。端到端测试覆盖健康接口和聊天输入框草稿交互，不发送模型请求。运行模型相关功能仍需在设置中提供对应供应商密钥。

## 文献解析与 RAG 范围

- PDF 文本提取由 PDF.js 完成；页面几何信息可用时按栏重排，随后按学术章节边界分块。页码只使用解析器实际观察到的页码，没有页码映射时保持未知。
- 当前不包含 OCR。扫描版或仅含页面图片的 PDF 无法提取正文；加密、损坏或解析器不支持的文件会返回可读错误。
- 检索结果按规范化 URL 去重并统一来源编号；可选 Reranker 不可用时回退到本地词项排序。该排序是规则处理，不是训练出的模型；项目没有宣称训练了嵌入模型或 Reranker。
- `contextLimit` 是字符数上限，不是精确 Token 计数。模型输出上限按设置传给 AI SDK，但供应商仍可能另有限制。
- 用量日志记录供应商返回的 Token 数；成本由仓库中的静态价格表估算，不等同供应商账单。

架构和工程边界见 [架构说明](docs/ARCHITECTURE.md)。面试讲解建议结合 [面试指南](docs/INTERVIEW_GUIDE.md) 和 [最终工程修复报告](docs/audit/final-engineering-remediation.md)。

## Academic Retrieval 评测与本地模型

主应用支持显式配置的本地 Embedding 与 Cross-Encoder 接口；未配置本地模型时继续使用 BM25。一个独立的 PyTorch 研究工程位于本地同级目录 `../ScholarKernel-reranker`，它冻结了 SciFact 数据、比较 BM25/Dense/Hybrid/预训练 reranker，并训练一个小型 SciFact reranker。实验指标、原始预测、训练参数和许可记录见 `docs/upgrade/phase3-evaluation.md`、`docs/upgrade/phase4-reranker.md`。

研究工程是独立 Git 仓库，不作为本项目子模块或源码依赖；权重与缓存未提交，需要按该仓库 README 下载/训练后才能启动本地 HTTP 服务。本地模型实测只验证了合成文档接线与公开 SciFact benchmark，不能据此宣称 ScholarKernel 用户文档或生成答案质量提升。限制见 [AI Evaluation 记录](docs/upgrade/AI_EVALUATION.md)。

Agent 本地协作约定见 [AGENTS.md](./AGENTS.md) 与 [.cursor/rules/](.cursor/rules/)。

## 环境变量

复制 `.env.example` 为 `.env.local` 并填写：

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | PostgreSQL 连接串 |
| `ENCRYPTION_SECRET` | **生产必填** | 服务端加密持久化 API Key；开发未设置时使用 dev fallback |
| `DATABASE_ENCRYPTION_KEY` | 否 | 与 `ENCRYPTION_SECRET` 二选一（优先读 `ENCRYPTION_SECRET`） |
| `PROXY_ACCESS_TOKEN` | 公开部署必填 | `/api/proxy/*` 鉴权；客户端经 `Authorization: Bearer` 或 sessionStorage `sk:proxy-access-token` 携带 |
| `PROXY_RATE_LIMIT_PER_MIN` | 否 | 每 IP 每分钟 proxy 请求上限，默认 60 |
| `AUTH_PASSWORD` | 公开部署建议 | 设置后需登录；API 与 Proxy 接受 session cookie |
| `AUTH_SESSION_SECRET` | Auth 启用时必填 | 会话签名密钥；未设时回退 `ENCRYPTION_SECRET` |
| `AUTH_USER_ID` | 否 | 登录用户的 DB userId，默认 `primary_user` |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `DEEPSEEK_API_KEY` | 否 | 服务端运行时模型密钥；也可在应用中配置。`GEMINI_API_KEY` 是 `GOOGLE_API_KEY` 的兼容别名 |
| `TAVILY_API_KEY` / `SERPER_API_KEY` | 否 | 学术搜索 Provider；无密钥时不能执行对应在线检索 |
| `COHERE_API_KEY` 或 `RERANK_API_URL` + `RERANK_API_KEY` | 否 | 可选服务端重排；缺少或调用失败时使用词项排序 |
| `LOCAL_EMBEDDING_API_URL` + 模型/revision/dimensions | 否 | 显式启用本地稠密向量；请求失败降级到 BM25 |
| `LOCAL_RERANKER_API_URL` + 模型/revision | 否 | 显式将文档片段发送到本机 Reranker；调用失败时保留检索结果 |

生成生产密钥示例：`openssl rand -base64 32`

**生产启动**：`NODE_ENV=production` 时若未配置 `ENCRYPTION_SECRET`（或 `DATABASE_ENCRYPTION_KEY`），应用将在启动阶段失败，避免用默认密钥加密用户 API Key。

**公开部署 Proxy**：生产环境必须设置 `PROXY_ACCESS_TOKEN`；浏览器请求 `/api/proxy/*` 时需携带相同 token（Bearer 或 `X-ScholarKernel-Proxy-Token`）。开发环境未设置 token 时 proxy 开放以便本地调试。

## 隐私模型（简）

| 层级 | 存放内容 | 说明 |
|------|----------|------|
| 浏览器 sessionStorage | 运行时 API Key（明文） | 当前标签页推理使用 |
| 浏览器 localStorage | 加密密钥包、Zustand 偏好 | 可选；主密码加密 |
| PostgreSQL | 对话、加密后的 runtimeKeys | 服务端 AES 加密持久化 |
| 第三方 LLM/检索 | 对话内容与检索 query | 由你选择的供应商处理 |
| `/api/proxy` | 转发流量 | 不持久化请求体；生产需鉴权 |

勿将 `.env` / `.env.local` 提交到 Git。

## 技术栈

Next.js 16 · React 19 · Prisma · Zustand · Vercel AI SDK · Tailwind 4

## Learning Studio 连接

接收端设置 `SCHOLAR_BRIDGE_TOKEN`（独立随机密钥）、`AUTH_USER_ID`（接收账号），可选
`SCHOLAR_DEFAULT_MODEL`（学习对话默认 DeepSeek 模型）。Learning Studio 设置相同的
`SCHOLAR_KERNEL_BRIDGE_TOKEN`，以及公开的 `SCHOLAR_KERNEL_URL` 和服务端
`SCHOLAR_KERNEL_API_URL`。服务端通过带 Bearer 密钥的
`POST /api/integrations/learning-studio` 保存原文、来源、问题；同一 UUID 重试只创建一次。

网页登录后自动打开对应对话并预填问题，原文也保存在 Canvas 文档中。导入不会调用模型。

共享 HTTPS 入口时，在构建前设置 `NEXT_PUBLIC_BASE_PATH=/scholar`，然后重新构建镜像；
反向代理保留 `/scholar` 前缀，将 `/scholar` 和 `/scholar/*` 转发至 `127.0.0.1:3001`。
`AUTH_URL` 使用公开的 `/scholar/api/auth` 地址。学习站服务端 API 地址也需要带 `/scholar`。
独立部署不设置此变量。不要删除 PostgreSQL 卷；备份同时保存数据库和 `ENCRYPTION_SECRET`。

若服务器连接 Debian 官方源缓慢，可设置 `DEBIAN_MIRROR=http://mirrors.aliyun.com` 再构建；npm 下载缓慢时可设置 `NPM_REGISTRY=https://registry.npmmirror.com`。

## ScholarKernel 2.0：服务端 Job（可选）

先应用增量迁移，再同时启动 Web 与独立 Worker：

```bash
npm run db:migrate
# 两个进程使用相同的隔离/开发数据库及加密配置
AGENT_DURABLE_JOBS=1 NEXT_PUBLIC_AGENT_EXECUTION=server npm run dev
AGENT_DURABLE_JOBS=1 npm run worker
```

生产构建时也必须设置 `NEXT_PUBLIC_AGENT_EXECUTION=server`。不设置该开关时保留旧浏览器执行路径；开启后普通聊天和科研工作流创建持久化 Job，SSE 仅观察，刷新不会重复启动。仅有 Web 进程不会消费队列。详情、状态转换、恢复和已知限制见 [Phase 1 说明](docs/upgrade/phase1-jobs.md)。公开部署前先完成 [数据边界待办](docs/upgrade/phase0-boundaries.md)。

新增测试入口 `npm run test:upgrade` 默认跳过真实数据库集成测试。使用全新、本机隔离的 `127.0.0.1:55446/scholar_upgrade` 数据库并设置 `SCHOLAR_UPGRADE_TEST_DATABASE=1` 才执行持久化回归；不要指向生产数据库。
