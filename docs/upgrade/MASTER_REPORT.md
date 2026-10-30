# ScholarKernel 2.0 工程升级总报告

日期：2026-10-30
仓库：`/Users/dingcs/Documents/Codex/2026-10-29/files-pasted-by-the-user-scholarkernel/outputs/ScholarKernel`
分支：`fix/phase1-foundations`
升级基线：`2871eb27e2523314a0091f13197662655384da1d`

## 执行结论

在既有 TypeScript/PDF 修复基础上，完成了数据边界、服务端 Agent Job、Academic RAG 本地文档检索、SciFact 检索评测和独立 PyTorch Cross-Encoder 研究。主仓库的工程检查和功能用例通过；本地 MPS 模型服务与隔离 PostgreSQL 的文档索引端到端集成通过。研究结果真实可复现，但受单英文 dev 集、候选池、标签和单种子等限制，不能外推到 ScholarKernel 用户文档或生成答案。

**当前判断：适合作为 AI/LLM 工程实习代表项目，定位为工程原型和带有真实实验的检索研究演示；不适合称为生产就绪平台，也没有证据证明其答案更准确或适用于公开部署。** Agent 多智能体对照、独立检索 test、真实供应商调用及用户文档评测仍未完成。

## 阶段和本地提交

主项目和 Python 研究项目是两个独立本地 Git 仓库。提交均未推送。

| 阶段 | 修改及验收 | 本地 Git commit |
|---|---|---|
| Phase 0：数据边界 | 文档服务、消息更新和人工干预的归属/状态处理；日志与配置边界。未运行安全攻击测试。 | `f58037abc32c2a2cb7301e82da0de4727b24c551` |
| Phase 1：服务端 Job | 持久化工作流、节点检查点、恢复、事件、取消和幂等边界。 | `bd303b06fa102e52b306a54e3239deb3c8f8c620` |
| Phase 2：Academic RAG | 文档 chunk 索引、BM25/可选 Dense、RRF、本地 reranker 接口、来源与页码映射。 | `2d9bf21814ddce1f008df10425d2acbca63a1b86` |
| Phase 3：检索评测（主项目文档） | SciFact 冻结数据评测、指标与人工来源抽样说明。 | `baf5c1703b79ccb0e62407f9dee2cc8a3921d891` |
| Phase 3：检索评测（独立研究仓库） | BM25、Dense、RRF、预训练 Cross-Encoder；原始结果与逐查询预测。 | `9f48c122e5ce3e20899138b03bd7fb2ecfe46921` |
| Phase 4：reranker 研究与接入文档 | 训练设置、模型服务、端到端集成证据、架构与面试说明。 | `1c7e0bd5267c6db39bcdb527419b73f1b146f9a9` |
| Phase 4：训练和本地服务（独立研究仓库） | 微调脚本、训练摘要、微调结果、来源映射样本与 loopback HTTP 服务。 | `20f60caebf3cfb30f594cb453a77f81155096b0a` |

基线 `2871eb2` 及之前的 PDF/TypeScript 修复与九份既有审计保留。未跟踪的 `docs/audit/delivery-manifest.json` 和 `docs/audit/evidence/` 是已有本地资料，没有纳入本轮提交或删除。

## 已完成修改

### Phase 0–2

- 通过已授权的防御性代码修改，限制文档服务访问已保存用户文档，增加消息归属写入约束及人工干预状态检查。没有在本轮运行认证/越权安全测试。
- 加入服务端 Job 状态、事件、检查点、恢复与取消路径。执行语义为至少一次；外部模型调用在 checkpoint 前可能重复。旧客户端执行路径仍可用但尚未完全统一。
- 保留 PDF.js 解析，切块保存稳定 chunk/source ID、实际可观测页码、parser version 和 hash。BM25 为本地基础路径；可选 embedding/Reranker 由显式 loopback/local endpoint 配置。
- PostgreSQL migrations 以 `migrate deploy` 为 CI/部署入口，不以 `db push` 替代；此前新建隔离 PostgreSQL 部署全部 10 条迁移并检查 schema parity。

### Phase 3：固定数据集检索评测

独立研究仓库固定 SciFact archive、文件哈希、许可来源、切分、模型 revisions、seed 和逐查询结果。语料 5,183 个摘要；300 个 dev claims 中 188 个有可用标注，112 个无标签查询单独报告。比较 BM25、Dense、Hybrid RRF、预训练 Cross-Encoder 与微调 Cross-Encoder。

宏平均主要指标：BM25 Recall@20/MRR@10/nDCG@10 为 `0.9479/0.7852/0.8163`；Hybrid 为 `0.9580/0.7896/0.8234`；微调 reranker 为 `0.9883/0.8838/0.9050`。完整表格见 [Phase 3](phase3-evaluation.md)。10 个 query 的 top-3 来源样本均可定位到冻结语料文献标题；摘要语料没有可核实页码，且未生成答案，因此论断支持性/事实性没有测试。

Agent 单 Agent、无协作多 Agent、协作多 Agent 受控评测没有执行。没有固定任务集/模型预算，且本任务边界不调用外部模型 API；不得把普通 Agent 测试或 Mock 结果包装成 AI 质量指标。

### Phase 4：本地 PyTorch Cross-Encoder

基于 pinned `cross-encoder/ms-marco-MiniLM-L6-v2`，以 SciFact train queries 微调二分类 Cross-Encoder。发现并剔除了与 dev 完全相同的两条 train query 文本；最终使用 505 个带证据 query group、564 正例 pair、2,020 个 BM25 未标注候选负例，训练 1 epoch。checkpoint hash 为 `81e76d68e3a50f482ace7dceb72be2d21ef89909eb6933bcbeda0bdca7b104cb`。模型权重未提交 Git；原始结果、配置和训练摘要已提交。

本机 Python 服务只绑定 `127.0.0.1`。实际请求返回 384 维 Embedding 和微调模型的 rerank 分数；ScholarKernel 使用本机模型配置和隔离 PostgreSQL 运行文档索引集成测试 3 项通过。它验证的是本机服务协议与工程接线，不是用户文档质量。

## 验收结果

本轮结束前：`npx tsc --noEmit` 通过；`npm run lint` 通过；`npm run test:quality` 24 文件 / 134 项通过；`npm run test:workflow` 8 项通过、1 项按既定范围跳过；Playwright 3 项通过；`npm run build` 通过，仅剩 Next middleware 弃用提示；真实本地模型集成测试 3 项通过；Prisma status 表示 10 条迁移均已应用且 schema diff 为空；研究 Python 单测 5 项、数据哈希和 compileall 通过；SciFact 检索和训练结果已生成。

前序 Phase 2 对照记录：`npm run test:upgrade` 10 文件 / 25 项通过；新建隔离 DB 部署 10 条迁移、重复部署和 schema diff 检查通过。GitHub Actions 未触发。每项检查的环境、限制和未执行项目见 [TEST_RESULTS.md](TEST_RESULTS.md)。

## 尚未完成或受限事项

- **评测**：没有独立 test split、多 seed、置信区间、显著性检验、跨学科/中文评测、Agent 对照或生成答案事实性评测。dev split 用于 epoch 选择；BM25 未标注负例可能含有真实相关文档。
- **产品 RAG**：SciFact 英文摘要结果不能外推到用户上传论文。应用没有 pgvector，单次最多载入 1,000 个 chunk；OCR、图表/公式语义理解、复杂阅读顺序与批量重建索引均未实现。
- **模型部署**：真实 LLM Provider/Token/成本未验证。PyTorch 服务只在本机 Apple MPS 跑通；CUDA、CPU 性能、跨机部署、服务守护和 SLA 未验证。checkpoint 不在 Git，需要重新训练或自行保留其本地权重。
- **Agent**：浏览器执行与服务端 durable Job 尚未完全统一；job checkpoint 前模型调用可能重试，且 Agent 质量对照未做。
- **构建/UI**：仍有 Next middleware 弃用警告和 Playwright React Flow nodeTypes/edgeTypes 重建提示。
- **CI**：工作流已存在，但没有运行 GitHub remote CI。

## 未处理的安全审计事项

本轮没有执行漏洞扫描、渗透测试、攻击模拟、认证或越权测试，也没有修改安全审计发现。原审计报告和既有 F01–F20 记录保留；后续应按独立授权计划审查用户数据边界、认证代理、可配置出站目标、日志、导出和依赖风险。完成普通工程升级不代表安全审计已完成或系统可公开部署。

## 后续需要人工核对

1. 检查 SciFact 与模型上游许可证要求及 attribution 是否满足计划发布场景；模型权重不包含在当前交付中。
2. 若准备公开展示用户文档检索效果，先建立有授权的标注集并隔离未见 test split。
3. 如需回答质量、Agent 协作收益或成本结论，先定任务集、成功标准、模型预算和人工评分协议，再执行多次受控实验。
4. 单独安排安全审计与生产部署检查，不将本轮的功能验证替代安全验收。

## 最终判断

**适合用作 AI/LLM 实习面试代表项目，但应称作“有可复现检索实验的工程原型”。** 候选人可以展示 Agent 状态与恢复、论文文档解析、来源映射、混合检索、训练流程和模型服务接口；必须主动说明 dev-set 与英文摘要边界、没有 Agent 对照、没有生成答案评测、模型未推送且不含权重、生产与安全检查未完成。不得称为生产就绪、普遍提升、答案准确率或成本节省已获证明。
