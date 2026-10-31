# ScholarKernel Phase 7 CI 结果

日期：2026-10-31

## 当前分支与远端

- 本地分支：feature/phase7-engineering-research
- 当前公开分支实现提交：85931be8333b759c02642f1ae9bdc5652307cab6。
- 远端 main：e129eb65e6bcbf6c2df9696c282613a557b672f1
- 远端 phase6-final-reliability-ai-validation：62055ecc7ced5738866f1b27b0032e3d31c76ba9；是本地 Phase 7 的祖先。
- 推送前通过 git ls-remote 核对，远端没有 feature/phase7-engineering-research ref；本次发布分支基于 Phase 6 新建。

只读命令：git ls-remote origin refs/heads/main refs/heads/phase6-final-reliability-ai-validation refs/heads/feature/phase7-engineering-research。输出只含 main 和 Phase 6 两个 ref。git merge-base --is-ancestor 62055ecc7ced5738866f1b27b0032e3d31c76ba9 HEAD 成功。

## 本地 workflow 配置

来源：.github/workflows/ci.yml

| Job | 配置与覆盖 |
|---|---|
| quality | Node 22；TypeScript、ESLint、quality fixtures、workflow tests |
| integration | PostgreSQL 16；首次和重复 Prisma migration、schema parity、upgrade integration |
| build | 独立 Next.js production build |
| browser-tests | PostgreSQL 16；Chromium、Playwright E2E |
| python-evaluation | Python 3.12；离线 answer-evaluation 单测与 compileall |

本地命令 npm run test:quality（25 files / 142 passed）、npm run test:workflow（8 passed / 1 skipped）、npx tsc --noEmit、npm run lint、npm run build、SCHOLAR_UPGRADE_TEST_DATABASE=1 npm run test:upgrade（12 files / 29 passed）、PLAYWRIGHT_CHANNEL=chrome npm run test:e2e -- --workers=1（5 passed）、python scripts/acceptance/test_answer_eval.py -v（5 passed）、python -m compileall -q scripts/acceptance 均已在本地执行并通过。完整环境及边界见 TEST_RESULTS.md。

YAML 结构静态解析识别五个 jobs。这不代表 GitHub runner 已执行当前配置。CI 配置位置：.github/workflows/ci.yml:12-172；独立构建 job 从第 87 行起，Python job 从第 156 行起。

## 推送前最近的远端 Actions 记录

只读 GitHub Actions API 最新记录是 [run #14](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41173148866)，完成状态 failure，head SHA 为 Phase 6 的 62055ecc7ced5738866f1b27b0032e3d31c76ba9，不是当前 Phase 7 SHA。

该次记录使用旧版单 job workflow。Node setup、依赖安装、迁移、重复迁移/schema parity、Vitest、TypeScript、Lint、Playwright 浏览器安装均完成。5 个 E2E 用例中 4 个通过、1 个失败；该远端 SHA 对应当时的 e2e/durable-job.spec.ts:30 等待创建流程中不会发出的 GET /api/conversations/{id}，超时 30 秒并重试两次；随后 Production build 被同一 job 的失败依赖跳过。具体失败日志来自 run 41173148866 的 job 124455158931。当前本地分支已将监听改为创建 POST、断言 response ID 与 URL 中 ID 相同，并将 build 拆为独立 job；该修复只由本地单 worker E2E 5/5 验证，尚无对应远端 run。

## 公开发布准备

原始本地分支的历史交接/部署文档含本机绝对路径、数据库位置和具体硬件型号。该历史已保留在本机 archive/phase7-engineering-research-unredacted 分支，不会推送。公开分支从 Phase 6 基线重建，已从交接、部署和研究报告中移除这些机器识别信息；关键实现文件与此前本地测试版本逐项比对一致。此报告撰写时尚未推送，所以没有 Phase 7 Actions 结果；推送后的远端 SHA 和运行结果以交付摘要为准。

尚未验证：GitHub runner 上的 Node 22、PostgreSQL 16 首次及重复迁移、schema parity、独立 production build、Playwright Chromium、Python job。Docker daemon 在本机不可用，不能替代 Compose 生命周期测试；本机 PostgreSQL 为 18.1，不能代表 PostgreSQL 16。

## 首次推送后的 GitHub Actions

已通过普通 git push 创建 feature/phase7-engineering-research；首次推送时本地与远端 SHA 均为 8998168316021264e7fc19dc054e1227582ab8bb。推送触发 [run #15](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41191072578)，事件为 push，head SHA 与首次推送 SHA 一致，最终结论 success。

| Job | 结果 |
|---|---|
| Typecheck, lint, and fixture tests | success |
| PostgreSQL 16 migrations and integration tests | success |
| Playwright end-to-end tests | success |
| Python offline answer-evaluation tests | success |
| Production build | success |

这证明首次公开 SHA 上的五个 CI jobs 均通过。后续若再推送报告修订，会产生新的 commit 和 workflow run；最终交付摘要记录了本次报告更新后的远端 SHA 与最新 run。

## 证据边界

本次远端状态通过 git ls-remote 与只读 GitHub Actions API 核对；原始本地历史未被改写或删除，发布分支使用已检查的净化副本。推送后的 SHA、GitHub Actions 运行和 job 结果见最终交付摘要。没有 force push、main 合并或生产部署。
