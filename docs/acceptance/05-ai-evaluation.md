# Phase 5.5：答案引用可信度与 Agent 效果评测

## 固定 Citation Support 任务集

新增 `fixtures/citation-support-v1.jsonl`，包含 10 条固定样本：从官方 SciFact dev 中按 claim ID 升序选择前 10 条带标注 evidence 的 claim，6 条 SUPPORT、4 条 CONTRADICT。每条包含 claim、原数据集证据句及句子索引、稳定的 `scifact:<document_id>` 来源 ID、预期关系和 `page_number: null`。这些是评测输入和黄金证据标签，**不是模型生成回答，也没有产生答案质量分数**。由于按 ID 顺序截取且仅 10 条，样本只供流程验证，不能代表学术问答总体质量。

数据来源、许可和选择方法见 `fixtures/README.md`。这批数据没有 PDF 页码映射，因此保留未知，不将抽象句序号写成页码。

## 可复核标注协议和指标

每个模型输出先拆成最小可判定的事实性原子论断；意见/组织性语言不计入事实论断。保留答案中的引用 token 与返回来源列表的 ID 映射，对照该来源实际 evidence 文本评估每条 claim。建议由两位标注者独立标注 `supported`、`partially_supported`、`contradicted`、`insufficient_evidence`，分歧由第三人裁决。引用编号存在与事实支持分开计分：

- **Claim-level Citation Support Rate** = 至少有一个可解析引用且被判为 `supported` 的事实原子论断数 / 全部事实原子论断数。未引用、来源无法解析、证据不足、部分支持、矛盾均不进入分子。
- **Citation Resolution Rate** = 能映射到本次实际检索源及原始证据的引用数 / 答案中所有引用数。只说明引用可定位，不代表内容正确。
- **Resolved Citation Support Precision** = 至少支持其所附 claim 的可解析引用数 / 全部可解析引用数。多个来源可逐 citation 计；需同时给 claim 级结果，避免同一 claim 的多余引用虚增。
- 单独报告 uncited factual claim count、unsupported/partial count、contradiction count、insufficient evidence/abstention count，以及 source-ID resolution failures。

若检索系统没有可信页码，标注者只判断 chunk/span/source 文本是否支持论断，页码指标记为不适用；不可用第一页填充。不能用来源编号正确率替代以上 claim 证据判断，也不使用模型自评作为唯一裁判。

## Agent 对照和消融设计

当前没有配置允许运行生成质量对照的真实模型/调用预算。本轮不调用外部 API、不将 runtime Mock 冒充模型效果。建议在将来可用同一固定模型、同一检索快照、相同可见上下文及相同 token 预算下对比：

1. Single-Agent：一个 Agent 完成检索整理和最终回答。
2. Multi-Agent without collaboration：多个 Agent 分工生成独立子结果，不共享彼此中间结果。
3. Collaborative Multi-Agent：多个 Agent 分享中间证据/结果后汇总。

对 10 项固定问题执行所有配置，并按问题配对。人工依据上述协议审查答案；并列记录任务成功/失败、总耗时、供应商实际报告 input/output token、可验证供应商账单或模型定价对应成本、超时/重试/取消错误。缺失 usage 时写 unknown；不从字符数推测 token 或费用。模型、prompt、检索结果、预算及工具配置均版本化，避免配置漂移混入对照。

生成式消融的计划矩阵：BM25 only、Dense only、Hybrid RRF、Hybrid + pinned pretrained Reranker、Hybrid + pinned fine-tuned Reranker。固定数据集、候选上限和答案模型，仅改变检索组件；对答案支持率和检索指标分别评分。SciFact 排序消融已有可复核 dev 结果，见 `04-ml-reproducibility.md`；这些结果不等于本项目用户 PDF 问答的生成式消融。

## 本轮状态

- 固定 task set：已生成并检查 10 行，6 SUPPORT / 4 CONTRADICT，来源 ID 对应 SciFact 文档，页码显式未知。
- 标注指标与协议：已定义，尚无生成答案可标注。
- Agent 三种架构对照：未执行；无真实模型预算，未做外部调用。
- 生成式检索消融：未执行。
- RAG 检索排名消融：已有 SciFact dev 结果并从预测 JSONL 复算，统计限制见第 04 阶段。
- 置信区间：只有现有 SciFact nDCG 的 exploratory paired bootstrap；不作为答案真实性或生成效果区间。
