# ScholarKernel 2.0 验证结果

日期：2026-10-30。测试使用隔离本机 PostgreSQL 和合成文档，不连接生产服务、不读取真实用户文件、不调用外部模型 API。

## 本轮结束前重跑

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过，退出码 0。 |
| `npm run lint` | 通过，退出码 0，没有输出 lint warning。 |
| `npm run test:quality` | 24 个文件、134 项通过。包含 PDF parser/lifecycle、RAG、embedding gateway、reranker fallback、Agent 状态和 Token 预算功能用例。 |
| `npm run test:workflow` | 8 项通过；1 项按脚本过滤跳过（`scopes by userId`），本轮未执行该归属专项。 |
| Playwright `npm run test:e2e -- --workers=1`，`NEXT_PUBLIC_AGENT_EXECUTION=server` | 3 项通过：health、普通聊天草稿、mock Job 创建与刷新观察。Durable Job 浏览器用例拦截 API；它不是后端持久化/真实 Worker 的替代验证。 |
| `npm run build` | Next.js production build 通过，TypeScript 与静态页生成成功。剩余提示：Next.js middleware 文件约定将弃用。 |
| `document-index.integration.test.ts`，真实本地模型 + 隔离数据库 | 3 项通过。测试用了合成文档和 loopback model service；覆盖 chunk、真实 embedding/reranker 协议调用、来源页码与编辑替换。 |
| `npx prisma migrate status` | 隔离数据库 `127.0.0.1:55446/scholar_upgrade` 显示 10 条迁移、schema up to date。 |
| `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code` | 通过；输出 `-- This is an empty migration.`。 |
| Python `unittest discover -s tests -v` | 5 项通过：BM25、指标、RRF、split 重复检查。 |
| Python `src/prepare_data.py` | archive SHA 与 corpus/train/dev JSONL SHA 全部符合 manifest。 |
| Python `compileall -q src tests` | 通过。 |
| SciFact retrieval benchmark + reranker train | 已运行并保存逐 query JSONL、指标和训练摘要；完整配置见 `results/`。Recall@20/nDCG@10 等限于 SciFact dev 的 evidence 检索，详见 [Phase 3](phase3-evaluation.md) / [Phase 4](phase4-reranker.md)。 |
| `git diff --check` | 提交前通过。 |

本机 Python 服务实际返回 all-MiniLM 384 维 embedding 和固定 checkpoint 的 Cross-Encoder 分数。服务只绑定 `127.0.0.1`，并以 `HF_HUB_OFFLINE=1` 运行模型调用。

## 前序阶段的验证记录

- Phase 2 `npm run test:quality`：24 文件 / 134 项通过；`npm run test:upgrade`：10 文件 / 25 项通过，使用隔离 PostgreSQL 与合成数据。该 upgrade 套件不是本轮重新执行。
- Phase 2 在新建隔离数据库应用 10 条迁移，重复部署后没有待迁移项，Prisma schema diff 为空；当前续跑又对隔离 `scholar_upgrade` 做了 status 和 schema diff 检查。
- PDF 专项回归此前 9 项通过；当前 quality suite 同样重跑了 PDF parser 与生命周期用例。
- Phase 1 durable job 跨进程恢复、并发认领、取消、事件及隔离数据库验证详见 `phase1-jobs.md`。当前的浏览器 Job 用例主要 mock API。

## 失败、未执行和限制

- 所列当前重跑的测试没有失败。
- GitHub Actions 没有触发，远端 CI 状态未知。
- Agent 单 Agent / 多 Agent 对照没有执行；本轮没有固定 Agent evaluation corpus，且不调用外部模型 API。
- 未在独立 test split 上报告 SciFact 指标；dev 用于 epoch 选择。没有置信区间、显著性分析、多 seed 对照或答案事实性评测。
- 真实供应商 LLM、token 和费用、生产 GPU、真实用户语料及生产延迟未验证。
- 远端 GitHub 未推送；这些提交只保存在本地。
- 没有运行漏洞扫描、渗透测试、攻击模拟、身份认证或越权测试。之前的专项授权边界测试仅在 Phase 0/更早普通工程阶段运行，未在本轮重跑。
- middleware 弃用和 Playwright 输出中的 React Flow nodeTypes/edgeTypes 重建提示仍待单独评估；当前 build/test 仍通过。
