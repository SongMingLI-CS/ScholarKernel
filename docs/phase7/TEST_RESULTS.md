# Phase 7 本地测试结果

执行日期：2026-10-31
执行环境：Windows 11 x64、Node 22.23.4 / npm 10.9.9、PostgreSQL 18.1、Chrome 158。

## 命令结果

| 命令 | 结果 | 环境/说明 |
|---|---|---|
| `npm ci` | 通过 | 1,131 packages；使用命令级 npm 官方 registry 覆盖，锁文件未改。 |
| `npm run test:quality` | **25 files / 142 passed** | Vitest；包含固定输入的 Agent/检索 fixture 审计。 |
| `npm run test:workflow` | **8 passed / 1 skipped** | Windows 命令引号修复后执行。按原脚本约定跳过 `scopes by userId` 测试。 |
| `SCHOLAR_UPGRADE_TEST_DATABASE=1 npm run test:upgrade` | **12 files / 29 passed** | 新建隔离 `scholar_upgrade`，本机 PostgreSQL 18.1；真实 DB / HTTP / Worker 组件，模型使用本地 mock。 |
| `npx tsc --noEmit` | 通过 | 单独执行；另一次与 `prisma generate` 并行时有临时文件缺失，生成结束后顺序复跑通过。 |
| `npm run lint` | 通过 | ESLint 无告警输出。 |
| `npm run build` | 通过 | Next.js 16.2.4；有既存 middleware-to-proxy 弃用提示。构建使用未创建的占位 DB URL，没有连接生产或业务数据库。 |
| `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e -- --workers=1` | **5 passed** | Playwright Chrome 158；全新 PostgreSQL 18.1 隔离 DB；Worker 与模型端点为 mock。Windows 默认 5 worker 并行时出现 2 项超时，单 worker 重跑通过；GitHub runner 在 `CI=true` 下也使用 1 worker。 |
| `npx prisma migrate status` | 通过 | 11 条迁移已应用。 |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` | 通过 | `No difference detected.` |
| Python answer-eval 单测 | **5 passed** | `python scripts/acceptance/test_answer_eval.py -v`；覆盖三组条件、人工标注计分、旧 `multi-agent` 标签兼容与配对完整性。 |
| Python syntax check | 通过 | `python -m compileall -q scripts/acceptance`。 |
| CI YAML 静态解析 | 通过 | 解析出 `quality`、`integration`、`build`、`browser-tests`、`python-evaluation` 五个 jobs。不是 GitHub Actions 运行结果。 |

## RAG 合成性能记录

升级集成测试生成随机合成 chunk，仅走 BM25 本地检索；5 次重复，当前 Windows + PostgreSQL 18.1。不是用户文档、真实语料、embedding/reranker 推理或生产并发测试。

| chunk 数 | 查询 p50 | 查询 p95 | 索引构建与插入 |
|---:|---:|---:|---:|
| 100 | 9.82 ms | 11.06 ms | 20.22 ms |
| 1,000 | 56.56 ms | 64.72 ms | 175.07 ms |
| 5,000 | 155.87 ms | 168.67 ms | 872.83 ms |

最新一次 PostgreSQL 集成套件串行运行记录如上；与此前重复运行相比，查询时间有明显波动。该 benchmark 帮助观察当前实现的规模趋势，不可外推到生产硬件、并发请求或混合检索延迟。

## Browser / fixture 边界

E2E 使用本地 PostgreSQL 和实际 Next 路由/Worker；模型由本机 HTTP mock 或 Playwright route fixtures 提供。`OPENAI_API_KEY=local-fixture-key` 仅用于兼容应用启动检查，并未向外部发送。没有记录真实供应商 token 用量、账单或模型效果。

初次测试发现原 E2E 在创建会话后等待一个不会发生的会话 GET。新建流程已通过 POST 返回值创建 store 状态，故测试现等待 POST 成功并核对返回 ID 与 URL ID；随后按输入框可见、空值和发送可用状态推进。最终完整 E2E 为 5/5。

## 远端验收状态

Phase 7 SHA 没有触发 GitHub Actions：推送审查在已提交 handover 文档中发现本机路径与硬件细节，按任务书停止公开同步。CI YAML 已静态解析，但 Node 22 / PostgreSQL 16 容器 / Playwright browser job 的 Phase 7 远端结果均**尚未验证**。本机只有 PostgreSQL 18.1；不能用本地结果代表 PostgreSQL 16 兼容性。
