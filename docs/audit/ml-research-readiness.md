# 独立 ML 科研仓库的接入准备度

基线：`e129eb65e6bcbf6c2df9696c282613a557b672f1`。方向：面向学术文献检索的轻量级重排序器（Reranker）与证据可信度优化。本文是可行性与实验设计，不是科研结果；没有训练模型，也没有评估论文创新性。

## 1. 判断

值得保留 ScholarKernel 作为应用与实验展示端，另建 Python/PyTorch 研究仓库。现有 `src/lib/document/rerank-gateway.ts:85-118` 已有 HTTP 适配入口，接入自主训练排序模型的工程成本较低；但可复现数据、可靠正文解析、固定候选和评测指标尚未建立，不能直接开始训练后宣称“提升 RAG 准确性”。

应用负责用户输入、语料访问、调用和证据展示；研究仓库负责数据、训练、损失函数、验证、基线、模型导出及实验记录。不要把训练脚本塞进 Next.js，也不要让研究依赖应用的 Zustand 或数据库状态。

## 2. 数据导出与构建

现有 AcademicSearchHit 只有标题、URL、摘要、日期、来源 ID；Document 是编辑内容；AcademicChunk 有 section/page/index。三者都不足以作为可追踪训练样本。应先设计稳定数据契约：

- corpus：doc_id、paper_id/DOI/arXiv版本、title、text、language、license、source_hash、parser_version；chunk 另记 chunk_id、section、真实页码或 unknown、原文偏移与父文档 ID。
- queries：query_id、query、语言、任务类型、来源、split；记录是否模型生成，避免混淆真实用户标注。
- qrels：query_id、doc/chunk_id、relevance、标注者、仲裁状态；必要时增加支持/反驳/信息不足及证据句。
- candidates：query_id、retriever/version、候选 ID、初排 rank/score、corpus_hash；完整保存 rerank 前候选，而非只保存已精选的 5 条。
- runs：数据版本、模型 checkpoint 哈希、训练配置、代码 commit、seed、依赖、硬件、指标及原始预测。

用户会话不应直接作为公开训练数据。先用许可清楚的公开语料，导出经过审查的非敏感字段；原始搜索摘要的许可和可重分发性另行核实。不要仅把 LLM 生成的相关性标签当真值；银标（Silver Label）与人工金标（Gold Label）分开。

## 3. BM25 基线

建立冻结全文或摘要 corpus 的倒排索引（Inverted Index），固定分词、大小写/标点、词干化和中文分词策略；记录 k1/b 与字段权重，只用验证集调整。所有查询从同一 corpus 检索 top-N。

项目当前 `lexicalRerankScores` 只在给定候选上计算 IDF，不是全库召回基线。亲自实现一个小规模 BM25 对照能帮助理解词频饱和、长度归一化和文档频率，再与成熟实现对比。先报告 Recall@100、MRR@10、nDCG@10；具体 K 依据任务预注册，不在看到测试结果后挑选。

## 4. Dense Retrieval 基线

使用冻结的预训练双编码器（Bi-Encoder）分别编码查询和文档，规定 pooling、归一化、最大长度、相似度和索引参数；先做小规模精确搜索（Exact Search）作为检索真值，再评估近似最近邻（Approximate Nearest Neighbor，ANN）的速度/召回折中。

这是预训练模型推理基线，不是自主训练。要体现训练能力，需要额外实现对比学习（Contrastive Learning）、负样本构造、批内负例（In-Batch Negatives）和梯度训练，并证明相对冻结编码器的变化。Embedding 模型与 Cross-Encoder 不要混称：前者可离线编码并检索，后者通常联合编码 query/document 后打分。

## 5. Cross-Encoder 与轻量化实验

交叉编码器（Cross-Encoder）输入 query 与候选文本对，联合注意力后输出相关性分数；只能重排已有候选，不能找回召回阶段遗漏的文档。实现顺序：冻结预训练 Cross-Encoder → 有监督微调 → 轻量模型/蒸馏。

训练可先使用二元交叉熵（Binary Cross-Entropy，BCE）或成对排序损失（Pairwise Ranking Loss），明确正负标签和采样。困难负例（Hard Negative）从训练 split 的 BM25/Dense 候选挖掘，人工检查“未标相关但其实相关”的假负例。轻量化可以比较层数、序列长度、蒸馏温度或量化，逐项做消融，不同时堆叠多个变量。

[Sentence Transformers 官方训练文档](https://www.sbert.net/examples/cross_encoder/training/rerankers/README.html) 给出 query/document 评分及有监督排序训练方式，可作为实现参考。使用框架完成训练也是训练，但要能解释损失、数据、反向传播和评价，而不只是运行示例命令。

## 6. Python 推理服务契约

保留 TypeScript HTTP 网关，Python 服务加载研究仓库产物。推荐将模型版本视为服务端固定配置，不让应用任意下载用户指定模型。最小协议可以是：

```json
{
  "request_id": "opaque-id",
  "model_version": "academic-reranker-v1",
  "query": "How is evidence selected?",
  "documents": ["candidate text one", "candidate text two"]
}
```

返回 `results:[{index,score}]`、model_version、处理时长、截断信息即可，分数不是概率则不要标为置信概率。当前网关已兼容该 results 结构或 scores 数组，但必须补 index 范围/唯一性、finite score、数量/文本长度限制、超时、取消、错误分类和降级日志。API Key 只在服务端保存，内部网络部署，不把训练服务直接开放给匿名请求。

应用主聊天目前在浏览器执行，因此需先明确重排放在服务端哪个入口。只配置 `RERANK_API_URL` 不会使浏览器自动访问该服务；这是一项接线工作，不能当作模型效果改进。

## 7. 准确性与延迟比较

做两组实验，不能混淆：

1. 固定同一批 top-N 候选，对 BM25 原顺序、预训练 CE、自训练 CE、轻量 CE 比较排序质量与重排时间，隔离排序贡献。
2. 同一冻结 corpus 上比较 BM25、Dense、混合检索及各自 +rerank，评价完整召回到排序链路。

统一机器、批量、并发、文本长度和模型精度；分别记录冷启动、预热后 p50/p95、吞吐（Queries per Second，QPS）、内存/显存、候选数及截断率。对 CPU 与 GPU 分开报告；单次缓存命中不代表普遍速度。总延迟要包含编码/检索/网络/重排，不能只给 GPU kernel 时间。

质量采用 qrels 的 Recall/MRR/nDCG，另做人工证据支持评测。用配对 Bootstrap 给不确定性，并保存逐查询结果；所有配置都没有当前实验数据，不填提升百分比。

## 8. 数据泄漏防范

按论文或研究工作分组划分训练/验证/测试，不能随机拆相邻 chunk；同一论文不同版本、翻译和近重复需合并识别。查询改写、同一 claim、同来源合成问题也要分组。测试 qrels 不用于选 checkpoint、调阈值、挖 hard negative 或挑 Prompt。

时间划分（Temporal Split）可作为补充，需检查预印本/正式版时间和版本。预训练模型可能接触过公开论文，不能保证“完全没见过”；如实披露模型与语料来源。记录去重算法、阈值和被排除样本，避免凭“不同文件名”声称独立测试集。

## 9. 配置与复现

研究仓库建议包含 data manifests、configs、src、train/evaluate/export 命令及结果目录；锁定依赖与模型版本。每次运行保存数据 checksum、split_hash、git commit、随机种子、优化器、学习率、batch/梯度累积、最大长度、epoch、early stopping、硬件和训练日志。

应用仓库只保存 HTTP 契约、调用适配和模型版本引用，不提交大型权重、用户数据或密钥。模型发布包应带配置、权重哈希、模型卡（Model Card）、适用语言和已知失败场景。推理服务版本改变时，应用日志记录同一版本，便于回溯。

## 10. 能力与创新性边界

**工程集成能力**：调用已部署 BGE/Cohere、增加 HTTP 端点、批处理、超时/缓存、部署和版本管理。很有价值，但不是训练或方法创新。

**能够体现 ML/DL 的工作**：构造可信数据、实现/解释 BM25、训练双编码器或 CE、设计困难负例与蒸馏、分析学习曲线、控制泄漏、完成公平消融和误差归因。

**可能的研究问题**：在学术长文和有限计算预算下，轻量 CE 是否能保持证据排序质量；将相关性与支持/反驳关系分开是否改善证据选择。二者只是待研究假设，不能把相关性得分直接当证据可信度。

[BEIR](https://github.com/beir-cellar/beir) 和 [SciFact](https://github.com/allenai/scifact) 可提供公开评测出发点，但不是对课题新颖性的证明。是否达到 SCI 或其他论文标准需另做系统文献调查、研究问题比较和外部评审，本轮未开展，不作承诺。

建议进入训练的门槛：解析不再静默污染文本、冻结 corpus/qrels、全库 BM25 可复现、固定候选保存完整。达到后再投入 GPU 和复杂训练，避免把应用数据问题误当模型问题。
