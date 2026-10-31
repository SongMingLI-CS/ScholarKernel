# Phase 7 本地运行与部署验收指南

## 本地开发环境

Phase 7 使用隔离 worktree 与 Node 22.23.4。当前机器的系统 Node 24 仍保持不变。PowerShell 示例（将路径替换为你的 clone/worktree）：

```powershell
# 请先确保 Node.js 22 已配置在当前 PATH 中。
node -v
npm -v
npm ci
npx prisma generate
```

不要把示例密钥写入 Git。复制 `.env.example` 到本机私有配置前，先确认目标文件不存在；测试只使用本地 fixture 值。真实服务需要按 `.env.example` 配置数据库、认证/加密、provider、academic search、embedding/reranker、Durable Job 与 SSE 所需变量。

本轮使用隔离 PostgreSQL 18.1 数据库进行验收；数据保存在本机临时工作区，不纳入仓库。若复用本机隔离数据库，先确认实例运行并检查连接；迁移只对新建隔离开发库执行：

```powershell
npx prisma migrate deploy
npx prisma migrate status
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
```

本机已有数据库只用于验收；不要将示例 URL 指向生产。Docker Desktop 已安装但 daemon 未运行，本阶段没有验证 Compose 拓扑。

启动本地应用：

```powershell
npm run dev
```

Durable Job 本机演示需要独立 worker、隔离数据库和本地 mock provider；普通 build 或 fixture 测试不表示真实供应商密钥、模型服务或账单已经验证。不要把 `local-fixture-key` 当作真实 provider key。

## 本地验收命令

```powershell
npx tsc --noEmit
npm run lint
npm run test:quality
npm run test:workflow
$env:SCHOLAR_UPGRADE_TEST_DATABASE = "1"
npm run test:upgrade
npm run build
npm run test:e2e
```

Playwright CI job 会安装 Chromium；本机也可用已安装的 Chrome 设置 `PLAYWRIGHT_CHANNEL=chrome`。升级集成和浏览器测试必须使用新建隔离数据库。

## GitHub Actions

`.github/workflows/ci.yml` 现在有五个独立 job：

- `quality`：Node 22、TypeScript、ESLint、quality tests 与 workflow tests。
- `integration`：PostgreSQL 16、11 条 migration、重复 deploy、schema parity、`test:upgrade`。
- `build`：Node 22 与隔离占位数据库 URL，不启动或连接业务数据库。
- `browser-tests`：PostgreSQL 16、migration、Playwright Chromium、mock-only E2E。
- `python-evaluation`：Python 3.12、离线答案评测单测和 compileall；不调用模型。

本地只静态解析 YAML，未运行远端 Actions。代码没有 push，因此 PostgreSQL 16 的迁移兼容性、GitHub runner 实际构建和浏览器 job 都仍需由之后触发的远端运行验证。

## 部署边界

当前状态适合本地开发与隔离环境演示。不要据本地 build 或 mock E2E 推断生产 readiness。生产前需取得真实 Actions 结果、PG16 全新 schema 验收、Docker Compose Web/Worker/SIGTERM 验收，并在另行授权和配置预算后验证供应商调用、监控与账单。Phase 7 没有部署或访问生产服务。
