# ScholarKernel Phase 7 CI 结果

日期：2026-10-31

## 当前分支与远端

- 本地分支：feature/phase7-engineering-research
- 当前实现提交：db7e4ae76c2ac014e67bb984ba917fc34d557ddb
- 远端 main：e129eb65e6bcbf6c2df9696c282613a557b672f1
- 远端 phase6-final-reliability-ai-validation：62055ecc7ced5738866f1b27b0032e3d31c76ba9；是本地 Phase 7 的祖先。
- 远端没有 feature/phase7-engineering-research ref；本次提交未推送。

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

## 最新远端 Actions 记录

只读 GitHub Actions API 最新记录是 [run #14](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41173148866)，完成状态 failure，head SHA 为 Phase 6 的 62055ecc7ced5738866f1b27b0032e3d31c76ba9，不是当前 Phase 7 SHA。

该次记录使用旧版单 job workflow。Node setup、依赖安装、迁移、重复迁移/schema parity、Vitest、TypeScript、Lint、Playwright 浏览器安装均完成。5 个 E2E 用例中 4 个通过、1 个失败；该远端 SHA 对应当时的 e2e/durable-job.spec.ts:30 等待创建流程中不会发出的 GET /api/conversations/{id}，超时 30 秒并重试两次；随后 Production build 被同一 job 的失败依赖跳过。具体失败日志来自 run 41173148866 的 job 124455158931。当前本地分支已将监听改为创建 POST、断言 response ID 与 URL 中 ID 相同，并将 build 拆为独立 job；该修复只由本地单 worker E2E 5/5 验证，尚无对应远端 run。

## 为什么没有 Phase 7 远端 CI

推送前的公开内容检查在分支历史中发现已提交 handover / 部署材料包含本机绝对路径、数据库位置和硬件环境信息。该 GitHub repository 是公开仓库；按任务书“发现敏感内容则停止推送并报告”的规则，本次没有推送。因而无法让 GitHub Actions 对 db7e4ae... 运行，也没有当前 Phase 7 远端 SHA。

尚未验证：GitHub runner 上的 Node 22、PostgreSQL 16 首次及重复迁移、schema parity、独立 production build、Playwright Chromium、Python job。Docker daemon 在本机不可用，不能替代 Compose 生命周期测试；本机 PostgreSQL 为 18.1，不能代表 PostgreSQL 16。

## 证据边界

本次远端状态通过 git ls-remote 与只读 GitHub Actions API 核对；没有推送、重跑 workflow、创建 PR、合并或部署。公开检查报告和提交详情保留在本地 worktree；推送前需先解决历史文档中的本地信息暴露问题，再对待发布提交重新做完整历史扫描。
