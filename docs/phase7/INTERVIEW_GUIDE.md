# ScholarKernel Phase 7 面试讲解提纲

## 1. 这次 Phase 7 做了什么？

从已验证的 Phase 6 commit `62055ecc` 建立隔离分支，修了两个 Windows 本机基线问题，补了证据约束的同行评审执行器状态，修正新会话 Playwright 的等待时序，并把 GitHub Actions 拆为质量、集成、构建、浏览器和 Python 答案评测 jobs。还增加了三条件离线答案评测工具，但没有生成真实答案。没有重写已存在的 Durable Job、RAG 或 UI。

## 2. 为什么基于 Phase 6，而不是 main 或 production-closure？

Phase 6 是祖先关系清楚、包含 31 个后续提交的已验证基线。`fix/production-closure` 与它明显分叉，带有 staging 运行与受限状态；整支合入会混入大量改动。旧设备 commit `8c4c3ae...` 在 Git 对象库和远端都不存在，所以没有声称恢复。

## 3. PDF 为什么在 Windows 上失败？

`pdfjs-dist` 检查目录字符串是否以 `/` 结尾。原代码用 Windows `path.sep`，传入反斜杠路径，PDF.js 在加载前直接拒绝。现在将目录分隔符转成正斜杠并保留 `/` 结尾，既符合 PDF.js 校验，也可由 Windows Node 文件系统读取。

## 4. Agent 如何避免引用幻觉？

同行评审节点之前若有检索步骤，执行器会将可验证来源 URL 和 citation 列表显式放入 Reviewer/Area Chair 上下文。检索失败或没有可核验来源时，依赖文献的审稿 group 以错误状态结束，不再继续生成看似有引用的审稿。fixture 测试验证了 URL 传递、无来源拦截和失败说明；这不是模型质量评测。

## 5. 如何处理 partial workflow 的错误？

如果前两个 reviewer 已完成而 Chair 失败，失败节点状态要保留，循环不能再把 group 后续节点改回 running。最终回答会附上未完成节点说明，避免成功 reviewer 文本遮盖失败。取消等待也会返回含 AbortError 语义的错误，便于调用方区分取消和成功。

## 6. Playwright 为什么改等 POST？

新建对话由 `POST /api/conversations` 返回会话摘要并直接写入 store；不会随后发出 `GET /api/conversations/{id}`。原测试先等 URL，再等待这个不存在的 GET，且事件监听注册得太晚。新测试在点击前监听 POST，核对其返回 ID 和 URL ID，再按输入框状态发送。

## 7. 本轮测试证明了什么？

质量集 25 个文件 142 项通过；workflow 8 项通过、1 项遵循项目既有过滤规则跳过；PG18.1 集成 12 文件 29 项通过；typecheck、lint、build、E2E 5 项、migration/schema parity 和 Python 评测单测 5 项通过。模型、搜索和生成结果由 fixture/mock 提供。没有真实模型调用，PG16 的远端 job 未运行。

## 8. RAG 的本轮实验是什么？

只跑了集成测试内的 synthetic BM25 基准，最新一次集成套件串行运行中 100/1,000/5,000 chunks 的本机 p95 约 11.06/64.72/168.67 ms。不同运行间有波动；没有 embedding、reranker、真实论文集或并发流量，因此不应把这个数字包装成端到端生产性能。

## 9. 微调 reranker 的实验结论是什么？

Phase 6 文档记录 NFCorpus test 上 3 seed 微调平均 nDCG@10 0.5589、预训练 0.5501，点差 +0.0088；逐 seed 区间并非都高于 0，且发现部分 corpus overlap。本轮没恢复独立研究 repo/checkpoint，也没有复算；答案生成和 Single/Multi-Agent 质量比较仍没有真实结果。

## 10. 是否可以部署生产？

不能据本轮证据作此结论。CI YAML 已拆分并静态解析，本地 build/E2E 通过；但没有 GitHub Actions 实际结果、PG16 本机测试、Docker daemon、真实模型 provider 或生产服务验证。本轮没有 push 或部署。

## 11. 下一步是什么？

先清理待公开的历史文档本机信息并重新审查，再触发 Phase 7 分支 GitHub Actions，确认 PostgreSQL 16 migrations/parity；再恢复并哈希校验独立 reranker 源码、数据和权重；最后取得明确预算及人工标注后，用冻结方案完成答案生成与三条件 Agent 对照。

## 12. 当前可以复现的演示是什么？

本机已用隔离 PostgreSQL 18.1、Chrome 158 和本地 mock provider 跑通 Durable Job、页面刷新恢复、人工干预和 Worker 处理的 Playwright 测试：`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e -- --workers=1`，5/5 通过。CI 里的 PG16 容器和完整手工 PDF 上传流程尚未在本机验证。

Mock 目前是自动化测试里的 mock server/route fixture，不是产品设置页的 Demo Mock 开关。面试演示时要明确说明模拟请求边界，不展示为真实 LLM 效果。真实演示应使用获授权 PDF，按部署指南启动 PostgreSQL、Web、Worker，再配置已批准的模型端点，依次展示文档索引、检索来源、答案引用、任务事件和刷新恢复。

## 附：三条件答案评测工具

scripts/acceptance/answer_eval.py 根据 docs/acceptance/fixtures/citation-support-v1.jsonl 准备固定任务请求，覆盖 Single-Agent、Multi-Agent without collaboration、Collaborative Multi-Agent。所有条件共用 taskset hash，并要求 model 与 token budget 相同。当前已准备 30 条请求，均为 pending_generation；Python 单测 5/5 验证请求准备、引用解析和人工支持标注汇总、配对约束与兼容性。

该工具不会生成答案，也不会自行调用模型。实验仍需要明确模型/版本、调用预算、被冻结的请求条件及人工 claim/evidence 标注。完成这些步骤前，不可报告 Citation Support Rate 或协作优势。完整状态见 AI_VALIDATION.md。

## 13. 简历项目描述素材

以下是按岗位侧重点整理的候选项目表述，不预设个人职责。只保留能由本人提交记录与面试者实际贡献证明的部分；数字均是本机工程测试结果，不表示生产用户规模或模型质量。

### AI Agent Engineer

- 在现有 Durable Job 执行器上补充检索证据传递与无来源审稿拦截，明确区分检索失败、部分执行失败和人工取消；用固定 fixture 覆盖来源 URL、失败状态与取消路径。
- 将持久化 Agent 的 Playwright 验收改为等待会话创建 POST、核对返回 ID 与 URL，并验证页面刷新后的同一任务恢复；单 worker mock E2E 5/5 通过。

### LLM Application Engineer

- 修复 Windows 下 PDF.js 资源目录分隔符导致的解析故障，并加入 Windows/Unix 路径回归用例。
- 将 CI 拆分为质量、PostgreSQL 集成、生产构建、浏览器 E2E 与 Python 答案评测 jobs；本地 Node 22 build、lint、typecheck 和 PG18.1 集成测试通过，PG16 远端结果待验。

### ML Engineer

- 扩展离线答案评测工具，统一生成 Single-Agent、无协作 Multi-Agent、协作 Multi-Agent 三组请求，并对人工标注后的引用解析、证据支持、延迟与真实 usage 汇总。
- 本轮没有生成答案或训练模型。SciFact/NFCorpus reranker 指标是 Phase 6 的项目历史记录；新设备未恢复独立研究仓库和 checkpoint，不可写成当期复现实验。

### Research Intern

- 围绕 10 条固定 SciFact-dev claim/evidence fixture 建立三组配对评测准备流程，固定任务集哈希与 token budget，保留逐答案标注字段和失败案例。
- 结果要求人工 claim 分解及证据判断；当前 30 条请求全部为 `pending_generation`，因此没有 Citation Support Rate、答案准确率或 Agent 协作收益结论。
