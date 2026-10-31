# ScholarKernel Phase 7 最终交付验收

日期：2026-10-31

## 交付结论

Phase 7 本地工程和离线答案评测工具已完成并提交；Node、PostgreSQL 18.1、Playwright 与 Python 本地验收通过。GitHub 远端没有 Phase 7 分支，当前 SHA 没有远端 Actions 结果。公开仓库历史文档含本机路径、数据库位置和硬件信息；按任务书的敏感内容规则，本次停止推送。独立 Reranker 工程和 checkpoint 未恢复；没有新的模型推理、训练或答案质量实验。

## 最终 Git 状态

- 分支：feature/phase7-engineering-research。
- Phase 7 实现 HEAD：db7e4ae76c2ac014e67bb984ba917fc34d557ddb，内容为三条件答案评测工具与 Python CI job。
- 实现阶段提交：9565c5c、e63c6a4、ed0c81c、a9b8ae0、db7e4ae。
- 共同基线：远端 Phase 6 SHA 62055ecc7ced5738866f1b27b0032e3d31c76ba9；祖先关系已检查。
- 旧设备提交 8c4c3ae425d1b564d4ce8a302ca8b1e7b79c4194 未在当前本地 Git 对象或已检查远端找到。
- git ls-remote 核对：origin/main=e129eb65e6bcbf6c2df9696c282613a557b672f1；origin/phase6-final-reliability-ai-validation=62055ecc7ced5738866f1b27b0032e3d31c76ba9；没有 Phase 7 远端 ref。
- 本报告与其余验收文档将作为实现提交后的独立文档提交；该提交 SHA 以提交完成后的 git rev-parse 输出为准，并记录在本轮交付摘要中。

没有 force push、历史改写、main 合并、生产部署或真实数据删除；没有创建 PR。原 checkout 的未提交工作未改动。

## 工程实现与本地验收

1. 修复 PDF.js Windows 资源目录规范化：src/lib/document/pdf-text-extract.ts；路径回归测试在 src/lib/__tests__/pdf-parser.test.ts。
2. 修复 Agent 证据约束、空来源审稿拦截和失败/取消状态：src/lib/agent-executor.ts、src/lib/agent/peer-review-runner.ts；workflow fixture 在 src/lib/__tests__/workflow-audit.test.ts。
3. Durable Job 的 lease、checkpoint、Worker 与事件通过 PostgreSQL 集成测试；相关实现和回归见 src/lib/agent/job-worker.ts、src/lib/__tests__/durable-jobs.integration.test.ts。
4. Playwright 新建会话改为监听 POST 并核对 response ID 与 URL ID：e2e/durable-job.spec.ts；固定 CI 单 worker 配置并实测 5/5。
5. CI 拆成 quality、integration、build、browser-tests、python-evaluation 五个 job：.github/workflows/ci.yml。
6. 三条件离线答案评估工具：scripts/acceptance/answer_eval.py；5 项 Python 单测通过。

本地结果：quality 25 files / 142 passed；workflow 8 passed / 1 skipped（按已有规则）；upgrade integration 12 files / 29 passed；E2E 5 passed；TypeScript、ESLint、Next.js build、Prisma migration status / schema parity、Python 单测和 compileall 均通过。E2E、模型输出使用 mock/fixture；PostgreSQL 版本为 18.1。命令和边界见 TEST_RESULTS.md。

## GitHub 与远端 CI

最新 Actions run #14：[GitHub Actions 链接](https://github.com/SongMingLI-CS/ScholarKernel/actions/runs/41173148866)，失败，head SHA 为旧 Phase 6 62055ecc...。旧测试等待不会发生的 GET 导致 30 秒超时；本地已修正等待 POST 的测试，且 build 拆分为独立 job，但这些变更没有 push，故没有 Phase 7 的 run 链接或远端通过结果。

公开同步前扫描发现已提交文档包含本地路径与硬件/数据库位置。由于 repo 为公开项目，按用户任务书暂停同步。需先对将发布的完整提交历史做隐私清理并重新审查，再决定如何正常推送；不能只修工作树后直接推送，因为旧内容仍在历史中。详情见 CI_RESULTS.md。

## Reranker 与 AI 评测

- 独立 ScholarKernel-reranker、研究数据、训练记录、NOTICE 与 checkpoint 未恢复。历史 checkpoint SHA 81e76d68e3a50f482ace7dceb72be2d21ef89909eb6933bcbeda0bdca7b104cb 未能通过实际文件验证。
- 隔离 Python 3.12 环境中的 PyTorch 2.12.0+cu130 检测到 CUDA 设备；本轮无模型代码与权重，未推理/训练。
- 固定 fixture 的三条件答案评估准备完成：10 tasks × 3 variants = 30 pending_generation 请求；taskset SHA-256 f44feeef6b1d84acf719247ed6d9576be85fe67559865ec099aa2f641153a8d2；不调用模型。
- 真实答案、人工 claim/evidence 标注、Citation Support Rate、多 Agent 成效、生成延迟/费用均未产生。
- Phase 6 SciFact/NFCorpus 指标保留为历史排序结果，不作为 Phase 7 新实验。

详见 ML_RECOVERY.md、AI_VALIDATION.md 与 AI_EVALUATION.md。

## 项目演示准备

当前可复现的是本机隔离 PostgreSQL + Chrome + mock provider 的 Durable Job / Worker / 页面刷新恢复 Playwright 测试。没有产品界面的 Demo Mock 开关。Docker daemon 不可用；Compose 启动顺序、PG16 runner、合法 PDF 的完整手工上传索引演示、真实 provider 和生产环境均未验收。面试说明边界见 INTERVIEW_GUIDE.md、DEPLOYMENT_GUIDE.md。

## 下一步最有价值的三项工作

1. 清理历史文档的本地绝对路径和硬件/数据库细节；对整个待发布历史重新运行凭据、隐私和大文件扫描，然后在确认安全后正常推送并等待五个 CI job。
2. 从合法备份恢复独立 Reranker 仓库、数据、许可证和 checkpoint，逐项比对 manifest 与实际 SHA-256，再做轻量推理复现。
3. 取得明确模型预算和人工标注流程，固定基模型、任务、检索和 token 预算，生成 30 条答案并完成 claim/evidence 标注后报告三条件效果。
