# ScholarKernel 部署就绪度

评估日期：2026-10-31。结论针对 Phase 6 分支的现有证据；没有访问生产服务、真实用户数据或外部模型 API。

## 状态

| 检查项 | 状态 | 证据或限制 |
|---|---|---|
| Next.js 本地生产构建 | **真实验证通过** | Phase 6 `npm run build` 使用隔离 PostgreSQL URL 通过，包括构建、TypeScript 与页面收集阶段。构建不等于部署。 |
| GitHub Actions 基线 | **失败** | 基线 Node 20 与 `pdfjs-dist 6.4.299` 的运行时要求冲突，见 [远端 run 41091103185](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41091103185)。 |
| Node 22 修复的远端 CI | **尚未验证** | Phase 6 未推送；不能据本地 Node 22 检查推断 Actions 通过。 |
| PostgreSQL 原 10 条迁移 / PG16 | **真实验证通过（基线 CI）** | 精确基线 Actions Job 的 PostgreSQL 16.15 成功部署并检查原 10 条迁移。 |
| 当前 11 条迁移 / 新增 migration 的 PG16 兼容 | **尚未验证** | 11 条在全新隔离 PostgreSQL 18.6 通过；CI 尚未运行该提交。 |
| Web + Worker + DB 本地闭环 | **真实验证通过（Mock 模型）** | 本机实际 Next 路由、Worker 子进程、PostgreSQL、SSE 与浏览器恢复已验证。 |
| Compose/Docker 镜像运行 | **尚未验证** | 既有环境 Docker daemon 不可用，未构建或启动镜像。 |
| Vercel 状态 | **平台状态报告成功** | 基线提交状态写有 `Vercel: success` / “Deployment has completed”；目标为 Preview 或 Production、production alias 与 Worker 是否存在均未确定。 |
| 生产服务或用户流量 | **尚未验证** | 没有访问或部署生产环境。 |
| 外部模型供应商调用与账单 | **尚未验证** | Agent E2E 只使用本地 HTTP Mock。 |
| 既有安全审计事项 | **未处理 / 本轮未验证** | 本 Phase 6 授权范围排除了安全测试；不能据普通工程验收宣称安全就绪。 |

本地 build 首次遇到 ignored cache 子目录中的 symlink 循环；移走该子目录后，因本地构建环境未提供 `DATABASE_URL` 在页面收集失败。最终复验通过隔离数据库 URL 和同级临时缓存目录移置完成；测试后缓存原样恢复。构建输出仍提示 Next.js `middleware` 命名约定弃用。Playwright 浏览器输出有 React Flow `nodeTypes` 重建警告。

## 部署前必须补齐的运行证据

1. 在 GitHub 上运行本分支提交的 Actions，确认 Node 22、PostgreSQL 16、11 条 migration、Schema Parity、普通功能测试、Playwright 和构建步骤均实际执行。当前 Workflow 成功状态不存在。
2. 使用与部署一致的 Node 版本、全新隔离 PostgreSQL 16 执行 11 条 migration、重复部署及 schema diff；不得连接生产数据库作验收。
3. 在 Docker daemon 可用的隔离环境构建 Compose 镜像并启动 Web 和 `durable-agent` Worker，验证数据库健康依赖、迁移顺序、SSE 路由和 SIGTERM 停止行为。Phase 6 本地 E2E 对执行闭环提供了 Mock 证据，但不等价于容器拓扑验收。
4. 由部署负责人确认 Vercel 项目目标、部署别名、环境变量和 Worker 运行位置。平台 commit status 本身不能判定 Preview/Production，也不能证明单独 Worker 在运行。
5. 单独配置真实模型凭据、预算和监控后，才进行获授权的供应商联通、usage 与账单核对；Phase 6 没有调用真实模型。
6. 公开或承载真实用户数据前，需另行安排项目负责人授权的安全和运维验收。本轮的普通功能测试不覆盖原审计记录中的安全事项。

## 当前判断

适合在本地和隔离环境进行继续开发、演示 Agent 持久任务闭环和运行工程验收。部署到生产的决定应等待上述远端 CI、PostgreSQL 16 新 migration 和真实容器拓扑证据；现阶段状态为**生产部署就绪度尚未确认**。
