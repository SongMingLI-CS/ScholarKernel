# ScholarKernel Phase 7 工程与研究总报告

日期：2026-10-31

## 摘要

本阶段从远端 Phase 6 commit `62055ecc7ced5738866f1b27b0032e3d31c76ba9` 继续开发，未替换项目或改动原有 checkout。完成 Windows PDF.js 路径修复、跨平台 workflow 测试命令修复、证据约束的同行评审执行器修复、新建会话 Playwright 时序修复，以及 CI 的质量、集成、构建和浏览器任务拆分。

全量本地质量测试 142/142、workflow 8 项通过/1 项按既有规则跳过、类型检查、lint、build、PostgreSQL 18.1 集成测试 29/29、浏览器 E2E 5/5、Python 离线评测单测 5/5 均通过。实验和 E2E 使用固定 fixture 或本机 mock；没有真实模型调用。三条件答案评测工具已实现，但 30 个请求仍为 pending_generation。Phase 6 的 NFCorpus 检索实验结果在文档中保留并明确标为继承结果，本轮未复算。生产部署、远端 PostgreSQL 16 CI 和独立 PyTorch reranker 仍待外部条件。

## 基线与接管

- 开发分支：`feature/phase7-engineering-research`，基于远端 Phase 6 HEAD `62055ecc7ced5738866f1b27b0032e3d31c76ba9`。
- 远端 `main` HEAD：`e129eb65e6bcbf6c2df9696c282613a557b672f1`；未发现远端 Phase 7 分支。
- 旧设备待迁移提交 `8c4c3ae425d1b564d4ce8a302ca8b1e7b79c4194` 未在远端或本地对象中找到，没有伪造恢复。
- 原 checkout 存在用户未提交工作，保持未修改。Phase 7 改动只在隔离 worktree。
- 本地工程 commits：`9565c5c`（workflow/PDF/证据处理）和 `e63c6a4`（CI job 拆分）。本报告随后的文档 commit 记录见最终 `git log`。

## Phase 7 已实现并验证

1. **Windows PDF 解析**：PDF.js 需要正斜杠结尾的资源目录路径；原实现传入 Windows 反斜杠，导致所有 PDF 文本解析失败。新增跨平台规范化及 Windows/Unix 路径单测，PDF parser 测试通过。
2. **Workflow 测试脚本**：Windows npm 的命令壳不将原有单引号视作分组引号，导致 Vitest 正则被截断。改用双引号后 `npm run test:workflow` 正常执行。
3. **证据约束审稿**：检索结果和 citation URL 会进入 Reviewer/Area Chair 上下文；若工作流包含研究检索但没有可核验来源，则阻止依赖文献的同行评审并给出错误原因。检索 `failed` 状态落为错误节点，不伪装为成功。
4. **错误和取消状态**：peer-review group 的成员失败后不再被循环重新标成 running；部分工作流输出会附带未完成节点错误，避免 Chair 失败被前序 reviewer 文本覆盖。取消错误明确包含 abort 语义。
5. **Playwright 会话初始化**：会话创建响应监听在点击前注册，验证 POST 成功，并要求返回 ID 与新 URL 的 `c` 参数相同。输入框和发送按钮按界面状态等待；无固定 sleep 或 force click。
6. **CI 拆分**：新增独立质量、PostgreSQL 集成、生产构建、Playwright、Python 离线答案评测 jobs；Node jobs 使用 Node 22，Python job 使用 Python 3.12。集成和 E2E 服务声明 PostgreSQL 16；push filters 覆盖 `feature/**`。YAML 静态解析出五个 jobs。
7. **三条件答案评测准备**：scripts/acceptance/answer_eval.py 支持 Single-Agent、无协作 Multi-Agent、协作 Multi-Agent 请求准备及人工标注后评分；固定 10 项任务生成 30 个 pending_generation 请求，测试 5/5。未调用模型，未得出答案质量结论。

## 按任务域的进展

| 域 | 本阶段结果 | 验证边界 |
|---|---|---|
| Durable Job / Worker / checkpoint / SSE / cancel / intervention | Phase 6 已有实现继续使用；29 项 PostgreSQL 集成测试和真实本机 Worker + mock E2E 通过。补充了执行器失败状态和恢复 UI 的时序验收。 | 没有压力测试、远端 PG16 或生产 worker 测试；没有另造 lease/fencing 系统。 |
| Academic RAG | 保留 BM25 的中文友好路径，不以 PostgreSQL `simple` GIN 替换。增加同行评审的来源约束；运行合成规模检索基准。 | 合成 BM25 基准没有 embedding、reranker 或生产并发流量。 |
| AI Evaluation | 保留 Phase 6 的 SciFact/NFCorpus 方法和局限；补上可配对的三条件离线答案请求与人工标注评分工具。 | 本阶段没有运行新的公开语料评测或 LLM 答案评分；当前请求均待生成。 |
| PyTorch 研究 | 项目/下载位置和 GitHub 仓库搜索均未找到 sibling repo 或 checkpoint；隔离 venv 已安装 PyTorch `2.12.0+cu130`，CUDA 可用性检查通过。 | 没有 reranker 代码和权重；未执行模型推理、训练或跨数据集评估。 |
| 产品使用体验 | 修复新会话 E2E 等待点，保留任务进度、取消、人工干预和引用逻辑。 | 没有无关 UI 改版；没有新加上传/离线状态 UI。 |

## AI 与 ML 结果

Phase 6 报告记录 NFCorpus 官方 test 的 3,633 篇语料、323 个 test query；3 个微调 reranker seed 的平均 nDCG@10 为 0.5589，预训练 reranker 为 0.5501，点差 +0.0088。逐 seed 的 query bootstrap 区间中两条包含 0；语料去重敏感性分析也报告在报告中。SciFact dev 用于模型选择，不是独立 test。来源、查询和语料重叠限制详见 [AI_EVALUATION.md](AI_EVALUATION.md)。

以上均为 Phase 6 文档与 artifact 中的历史结果，不是本设备新跑的实验。独立答案生成 Single-Agent/Multi-Agent 对照仍未生成真实答案。当前没有任何新训练指标。

## 验证分类

- **本地已实现且验证**：PDF 路径、Workflow 命令、Agent evidence/error/cancel 行为、Playwright 会话创建、CI YAML 结构、本地 build、11 条 PostgreSQL 18.1 迁移和 parity。
- **仅 mock/fixture 验证**：本地模型流、学术检索回答、同行评审内容、Durable Job E2E 中供应商请求。无外部 API 或真实供应商用量。
- **继承但未在本轮复算**：Phase 6 SciFact/NFCorpus 排名与 checkpoint 元数据。
- **尚未验证/环境受限**：GitHub Actions 实际运行、PostgreSQL 16 新迁移、Docker Compose 服务拓扑、真实模型和 GPU 推理、生产部署。

## 下一步优先级

1. 在用户控制的 PR/Actions 流程中运行新增 CI jobs，尤其确认 PostgreSQL 16 的 11 条迁移与 schema parity。
2. 从旧设备 bundle/备份恢复 `ScholarKernel-reranker` 和合法 checkpoint 后，先核对哈希、许可证、数据哈希，再验证 CPU/CUDA 推理。
3. 为独立答案评测取得明确模型预算和人工标注后，开展 Single/Multi-Agent 对照；不把检索排序提升外推成答案质量提升。
4. 再考虑产品证据可视化或检索服务优化，保持可复现数据与用户文档隔离。

## 提交与远端状态

变更保存在本地 `feature/phase7-engineering-research`。公开仓库已提交 handover / 部署材料中含本机路径、数据库位置和硬件信息，按任务书停止 push；本阶段没有 push、main merge 或部署，当前 Phase 7 SHA 没有远端 Actions 结果。最新远端 Actions run 属于 Phase 6 SHA。详细结果见 [CI_RESULTS.md](CI_RESULTS.md)、[TEST_RESULTS.md](TEST_RESULTS.md)，模型恢复及答案评测边界见 [ML_RECOVERY.md](ML_RECOVERY.md) 与 [AI_VALIDATION.md](AI_VALIDATION.md)。
