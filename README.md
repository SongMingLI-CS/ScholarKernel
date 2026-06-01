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

复制 `.env.example`（若有）或自行配置，常见项：

- `DATABASE_URL` — SQLite 路径
- `ENCRYPTION_SECRET` / `DATABASE_ENCRYPTION_KEY` — 运行时密钥加密

勿将 `.env` 提交到 Git。

## 技术栈

Next.js 16 · React 19 · Prisma · Zustand · Vercel AI SDK · Tailwind 4
