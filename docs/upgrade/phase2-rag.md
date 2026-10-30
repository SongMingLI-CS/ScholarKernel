# Phase 2：Academic RAG 2.0

## 目标与数据流

本阶段把当前会话的已保存文档纳入 Academic Search：

`导入文档 → PDF/DOCX 解析 → 章节/页码分块 → PostgreSQL 索引 → BM25 与可选 Dense 召回 → RRF 融合 → 可选 Reranker → 带来源的证据片段`

网络论文检索仍可独立运行；本地文档证据与网络结果在 Agent research 节点合并，引用编号按统一结果重新分配。提供方不可用时保留可用的 BM25/RRF 结果。不会把未观测到的页码补成第 1 页。

## 文档处理和来源映射

- `academic-semantic-chunker.ts` 使用解析器提供的章节及页码，将段落边界合并为语义分块；跨页内容按可观测页面切分。页码映射采用归一化文本精确匹配，重复内容无法唯一映射时标记未知。解析器没提供真实页码时保留 `null`。
- PDF 的单栏/双栏阅读顺序沿用 `layout-aware-parser.ts` 和 `column-reorder.ts` 的坐标规则。顺序不能可靠判断的复杂混排、扫描图片和无文字层 PDF 不能保证完整解析；当前没有 OCR 流程。
- `DocumentChunk` 保存稳定 ID、Document ID、chunkIndex、section、可选 pageNumber、原文、SHA-256 contentHash、parserVersion 和可选 embedding/model/revision。新建或编辑已保存文档时在数据库事务内替换分块；旧文档按需补建分块，页码仍保持未知。
- ID 由文档、章节、可观测页码、文本哈希及同一身份的重复序号确定，不因另一个不同分块插入到前面而改变。更改文本后会产生新的 chunk ID。
- 引用元数据包含 `documentId`、`chunkId`、可选 pageNumber 和原始 snippet；页面未知时 URL 仍可定位分块，但引用不显示虚构页码。

## 召回、融合和重排

### BM25

`rerank-gateway.ts` 提供每次检索在当前候选语料上计算的 BM25 词频/文档频率/长度归一化分数。英文按词项处理，中文连续汉字按相邻二元组拆分。默认 `k1=1.2`、`b=0.75`；`RAG_BM25_K1` 允许 0–3，`RAG_BM25_B` 允许 0–1，其他值回退默认值。BM25 是当前无可用 Dense/Reranker 时的可解释基线，不宣称语义匹配能力。

本地文档检索上限为每次最多加载 1000 个分块，References 章节不作为正文证据；BM25/Dense 各取最多 28 个候选，再以 RRF（常数 60）融合，默认返回 8 条。该实现没有 PostgreSQL 全文索引或 pgvector；Dense 余弦计算在应用层执行，所以应用层有 1000 块上限。

### 可替换的 Dense Embedding

`DenseEmbeddingProvider` 以批处理接口封装提供方；HTTP adapter 要求服务回报与配置一致的模型名、修订号、向量维数和对应批量向量，按最多 32 条分批，校验有限数值并归一化。存储 JSON 向量保留模型和 revision；同版本向量复用，换版本时只对最多 128 个缺失分块按需重算。请求有 20 秒超时，失败记录诊断并继续使用 BM25。

默认配置建议为 `BAAI/bge-m3`，官方模型 revision 固定为 `5617a9f61b028005a4858fdac845db406aefb181`，向量维数 1024，单位归一化后按 cosine 排序。模型卡说明其多语言和多检索能力；这只是候选模型，不意味着 ScholarKernel 已验证该模型在本项目语料上优于 BM25。[BAAI/bge-m3 模型卡](https://huggingface.co/BAAI/bge-m3)

服务通过 `LOCAL_EMBEDDING_API_URL` 提供，须同时设置 `LOCAL_EMBEDDING_REVISION`。未配置时不发出网络请求、不生成向量，RAG 使用 BM25；接口可替换，底层 JSON 存储也可迁移到向量库。当前没有在应用环境中安装或启动 embedding 服务，因此真实模型向量及检索收益留待 Phase 3/4 实测。

### RRF 和 Cross-Encoder

- `fuseAcademicSearchHits` 以稳定 URL 或 `scholarkernel://documents/{documentId}/chunks/{chunkId}` 去重，以 reciprocal-rank fusion 汇总不同 query 和 lexical/dense 列表；source_id 在最终融合后重新编号。
- `rerankAcademicHits` 支持显式本地 HTTP、已配置 Cohere、已有通用 HTTP Reranker，最后降级到 lexical BM25。响应索引必须在候选范围内且分数为有限数；服务超时 15 秒。Rerank 命中保存分数和已配置模型版本。
- 本地文档片段只会发送给 `LOCAL_RERANKER_API_URL` 明确配置的服务；本地文档检索不会调用 Cohere 或通用外部 Reranker。没有本地服务时返回 RRF 顺序。
- 本地 reranker 要配置服务 URL、模型和精确 revision；响应模型/revision 不匹配或异常时忽略并继续降级。文档片段从不因故障变成外部模型输入。

## 验证

本阶段在未调用真实模型 API 的情况下完成以下验证：

- `npm run test:quality`：24 个文件、134 个测试通过。覆盖 chunk ID、页码与章节映射、BM25 中文分词/参数、embedding 批处理/模型与维数校验/归一化、local reranker 版本与异常降级、引用融合。
- `SCHOLAR_UPGRADE_TEST_DATABASE=1 ... npm run test:upgrade`：10 个文件、25 个测试通过，使用 loopback 隔离 PostgreSQL 和合成用户。覆盖 Document API 写入分块、页码来源、编辑后替换、旧文档惰性索引、本地 Dense 与 Cross-Encoder HTTP 契约，以及 Phase 1 集成回归；Embedding 和 Reranker 响应由测试 mock 提供。
- 空数据库 `scholarkernel_phase2_clean` 应用全部 10 条迁移；重复 `prisma migrate deploy` 显示无待处理迁移；数据库与 Prisma Schema diff 输出空迁移。
- `npx tsc --noEmit`、`npm run lint`、`npm run build` 通过。构建仍报告 Next.js middleware 约定弃用提示。
- Embedding/reranker tests 使用确定性 mock，不是模型效果、延迟或成本测量。真实本地 Python 服务端到端协议验证在 Phase 4 记录。

后续 Phase 4 已补充实际本机协议验证：固定版本的 embedding 服务返回 384 维向量，微调 reranker 返回可解析分数；本机模型环境变量下 `document-index.integration.test.ts` 3 项通过。该验证未改变本阶段原始 mock 测试的性质，也不代表用户文档质量评测。

## 限制

- 无文字层的扫描 PDF、手写内容、需要 OCR 的页面无法从当前文本解析器还原。
- 表格、复杂公式、图表、跨栏混排和特殊阅读顺序可能产生不完整或顺序错误的文字；当前不生成结构化表格/公式语义。
- legacy 文档仅有纯文本时可以分块检索，但缺失来源页码仍为未知。
- 当前对话级本地索引只读最近更新的至多 1000 块；更大文档集合需分页检索或数据库向量索引。
- Dense 检索与 reranker 取决于用户明确配置且保持可用的本地服务；未配置时 BM25-only。模型升级后按需补向量，尚无批量离线重建命令。
- BM25/Dense/RRF 与两种 Cross-Encoder 的 SciFact dev 对比、查询级结果和来源抽样见 Phase 3/4。它不是用户文档或生成答案评测，不宣称产品 RAG 质量提升。
