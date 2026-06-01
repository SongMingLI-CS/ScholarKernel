# ScholarKernel Web

ScholarKernel 的 Web 全栈客户端：对话式学术 Agent UI、多模型网关、本地会话持久化（Prisma + SQLite）。

**产品主仓库**：[SongMingLI-CS/ScholarKernel](https://github.com/SongMingLI-CS/ScholarKernel)

## 开发

```bash
npm install
npm run db:push    # 首次同步 SQLite schema
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
| `DATABASE_URL` | 是 | SQLite 路径，如 `file:./prisma/dev.db` |
| `ENCRYPTION_SECRET` | **生产必填** | 服务端加密持久化 API Key；开发未设置时使用 dev fallback |
| `DATABASE_ENCRYPTION_KEY` | 否 | 与 `ENCRYPTION_SECRET` 二选一（优先读 `ENCRYPTION_SECRET`） |
| `PROXY_ACCESS_TOKEN` | 公开部署建议 | `/api/proxy/*` 鉴权（见下方安全说明） |

生成生产密钥示例：`openssl rand -base64 32`

**生产启动**：`NODE_ENV=production` 时若未配置 `ENCRYPTION_SECRET`（或 `DATABASE_ENCRYPTION_KEY`），应用将在启动阶段失败，避免用默认密钥加密用户 API Key。

勿将 `.env` / `.env.local` 提交到 Git。

## 技术栈

Next.js 16 · React 19 · Prisma · Zustand · Vercel AI SDK · Tailwind 4
