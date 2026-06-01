# ScholarKernel Web — Agent 指南

## 仓库

- **产品主仓**：[github.com/SongMingLI-CS/ScholarKernel](https://github.com/SongMingLI-CS/ScholarKernel)
- **本目录**：`scholarkernel-web` — ScholarKernel Web 客户端（Next.js + App Router API + Prisma SQLite）

## Next.js 16

本仓库 Next.js 与常见训练数据可能不一致。改 App Router、配置或数据获取前，先查阅 `node_modules/next/dist/docs/` 中的当前版说明。

## Agentic 工作流

本仓库启用 **TDD + 自动 Debug + 自动 Commit** 挂机闭环，规则位于：

- **主流程**：`.cursor/rules/agentic-tdd-loop.mdc`（`alwaysApply: true`）
- **兼容入口**：根目录 `.cursorrules`
- **测试 / 调试 / Git**：`.cursor/rules/testing-standards.mdc`、`debug-protocol.mdc`、`git-automation.mdc`

闭环摘要：**先写失败测试 → `npm test` + `npm run lint` → 最小实现 → 失败则假设-证据-修复（≤8 轮）→ 全绿后自动 atomic commit（不 push）**。

## 技术栈

Next.js 16 · React 19 · TypeScript · Prisma (SQLite) · Zustand · Vercel AI SDK · Tailwind 4

## 关键路径

- API：`src/app/api/` — 使用 `@/lib/api-utils`、`@/lib/auth-user`、`@/lib/prisma`
- Agent：`src/lib/agent-executor.ts`、`src/lib/ai-gateway.ts`
- UI：`src/components/` · 状态：`src/store/useAgentStore.ts`

## 命令

```bash
npm run dev      # 开发
npm test         # Vitest（TDD 闭环必跑）
npm run lint     # ESLint（TDD 闭环必跑）
npm run build    # prisma generate + next build
npm run db:push  # 同步 schema
```

## 安全

勿提交 `.env*`、`prisma/dev.db`、明文 API Key。`generated/prisma` 为生成目录。
