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

## 开发

```bash
npm install
npm run db:push    # 首次同步 PostgreSQL schema
npm run dev        # http://localhost:3000
```

## 质量门禁（Agent / CI）

```bash
npm test           # Vitest
npm run lint       # ESLint
npm run build      # prisma generate + next build
```

Agent 挂机闭环见 [AGENTS.md](./AGENTS.md) 与 [.cursor/rules/](.cursor/rules/)。

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

若服务器连接 Debian 官方源缓慢，可设置 `DEBIAN_MIRROR=http://mirrors.aliyun.com` 再构建。
