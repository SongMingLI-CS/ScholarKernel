# Academic RAG 质量与评测能力

基线提交：`e129eb65e6bcbf6c2df9696c282613a557b672f1`。本文只使用已取得的源码和执行证据。检索增强生成（Retrieval-Augmented Generation，RAG）应同时说明检索对象、检索算法、证据传递及生成约束，不能凭模块名称认定存在完整向量检索。

## 1. 实际实现分类

- **已经接通的工程功能**：浏览器文件上传、服务端解析入口、Tavily/Serper 网络搜索、URL 去重、学术域名过滤、来源列表、Markdown 引用格式和章节切片。
- **规则或启发式（Heuristic）**：正则章节识别、坐标/奇偶行重排、Unicode 数学符号替换、章节切片、英文空格分词、BM25 风格候选重排、意图/检索式扩展。
- **外部模型接口已实现，真实效果未验证**：Cohere rerank、可配置 BGE HTTP、外部 Layout Parser。接口存在不代表服务已部署，也不代表当前浏览器路径使用了它们。
- **外部 LLM API**：规划、query 改写、推理、角色评审及汇总；没有发现这些模型的训练代码。
- **当前未发现完整实现**：Embedding 生成、持久化向量索引、自有论文语料的 Dense Retrieval、索引增量更新/版本、文档级访问控制检索、标准 qrels 和检索质量评测管线。

最准确的当前描述是“网络学术检索 + 可选重排 + 文本上下文生成，并带本地文档预处理原型”，不能写成已经构建自主训练的学术检索系统。

## 2. PDF 解析的两类实测错误

入口：`browser-file.ts:60-81 → /api/documents/parse → layout-aware-parser.ts:151 → extractPdfFromBuffer`。

### 2.1 未压缩内容流可不返回

`pdf-text-extract.ts:54-125` 按字符串流扫描；第 84、92、99、109 行在处理 Tm/Td/Tj/TJ 时减少 for 索引。Tj 分支减少 1 后，循环自增 1，再次回到相同操作符；Td 也会循环到自身。

已生成合法单页 PDF，具有 Catalog、Pages、Page、Font、Contents、xref 和 trailer；未压缩版本 593 字节，内容含 `BT /F1 12 Tf 72 720 Td (...) Tj ET`。测试子进程打印 PARSER_ENTER 后两秒不退出，被受控超时 SIGTERM 终止。没有把该输入发给真实服务，未做压力测试。[脚本](evidence/probes/pdf-probe.cjs) / [输出](evidence/logs/pdf-probe.log)

### 2.2 压缩内容流返回空文本

同一 PDF 内容流采用 zlib Deflate 并声明 `/Filter /FlateDecode`，文件 622 字节。当前解析结果 `text:''`、`blocks:[]`，但仍识别到 MediaBox。

具体源码：第 55 行 `buffer.toString('latin1')`；第 59 行正则 `stream...endstream`；第 69-71 行直接处理原始 stream。没有依据 Filter 解压、读取交叉引用/对象流、字体 Encoding/ToUnicode 映射。因此无法从压缩正文恢复文本。不能通过“找到了 MediaBox”推断已解析页面正文。

此外按 stream 数递增 page（第 70 行）不等于 PDF 页数，一页可有多流、资源流也不是页面。正则 token 的首选非空白分支也不足以完整实现 PDF 字符串/TJ 数组语法。真实论文中的字体、合字、扫描页、旋转、表格和公式准确性尚未验证。

防御性修复方向：采用健壮解析后端；在独立 Worker/子进程设限，支持超时/取消和解压资源限制；失败明确返回 unsupported/empty，而不是继续生成“已读全文”。外部 Marker/MinerU 适配点可以保留，但部署、输出契约和真实语料评测都需独立验证。本轮不继续漏洞复现；安全影响受安全策略限制，未进一步验证。

## 3. 双栏、章节、公式和分块

### 双栏阅读顺序

坐标路径按页面和中轴分栏，再各按 y 排序，属于合理的简化起点；没有处理跨栏标题、跨栏图表、页眉页脚和局部多栏切换。文本路径 `column-reorder.ts:130-161` 仅按短行比例和奇偶长度判断；已将普通单栏 8 句打乱成 1,3,5,7,2,4,6,8。建议无明确版面证据时保留输入顺序，置信度不足输出 unknown。

### 章节与公式

`academic-semantic-chunker.ts:21-65` 用英文标题和 Markdown 正则，中文标题、非标准节名及正文以 Introduction 等词开头可能误判。`formula-normalizer.ts` 是 Unicode→LaTeX、公式行和环境包裹规则，**不是公式 OCR、视觉识别或数学语义恢复模型**。它不能修复已在 PDF 提取阶段丢失的上下标/结构。

### 页码与分块

`inferPageForText(..., fallback=1):74` 无匹配也返回 1，`167` 的 `??` 无法触发后续估算。已确认无页信息的两段都写 p.1，应当保留 unknown，不能伪装真实来源页。

每个 chunk 主要对应整节，没有最大 Token 上限、段落窗口、重叠和父子索引。长章节可能超过上下文预算；`formatAcademicChunksForContext` 仅取前 12 个，按位置而非 query 相关性。`enrichPeerReviewSubject` 原文加切片，重复增加输入。

浏览器上传函数只读取 `data.text`，丢弃服务器返回的 chunks、ragContext、warnings、page 等结构，后续不能可靠追踪段落来源。当前 Document 模型保存内容，不是一个带 stable chunk_id、页坐标和证据哈希的语料库。

## 4. 检索、重排和上下文

搜索宽召回默认 28 条，重排默认取 5 条。实际候选是标题、URL 和搜索摘要，不是论文完整章节。宽泛主题可扩三路，两 research 节点可能重复检索；合并后没有全局统一重排/总 top-k，最终候选集合与“精选 5 条”的描述可能不一致。

`rerank-gateway.ts:25-58` 是 BM25 风格公式，但文档频率/平均长度只针对本次候选集合，没有全语料索引和检索器。这是候选排序兜底，不能作为独立全库 BM25 baseline。中文按空格切词，已观察“学术文献检索”对“学术文献检索方法”和无关文本都得 0。

Cohere 优先、BGE HTTP 次之、词项规则最后；非 2xx 可能返回 null 降级，但网络异常抛出和请求永不结束没有可靠统一处理。返回 index/score 缺边界、有限值、去重和数量校验。浏览器主执行器无法读取普通服务端环境变量，故服务端配置 BGE 不代表 UI 自动启用。以上为静态行为，外部真实重排质量/延迟未测。

上下文一般仅留 480 字符摘要，子任务中再留 360 字符，可能丢掉支撑或否定结论的句子。检索结果作为 assistant 历史、JSON、引用列表多次出现，会挤占有效证据。500 字符文件预览截断已有受控验证。

## 5. 引用真实性

已实现 source_id、标题、URL、日期，引用列表格式化和 References 去重；这属于引用展示与元数据传递。缺少 claim→evidence span→doc/page 的可核验映射、引用 entailment 校验及全文快照。

多 research 节点存在编号歧义：全局 sources 经 `mergeAcademicSearchHits` 重新编号，但各次 out.results 保持局部编号；`pushResearchIntoSessionContext` 又把局部结果与全局 citationsMarkdown 放在同一上下文，子任务序列化保留局部编号。第二批结果的 [1] 可能与全局 [1] 不一致。这是静态确认的编号风险，真实生成错误引用比例未验证。

`normalizeReferenceSections` 只整理文末，不改变正文引用指向；不会证明模型观点受到来源支持。`globalLiteratureReview` 没有把当前检索证据作为强制输入，生成出的作者/年份参考也不能默认为真。Imported BibTeX/RIS 本身是用户输入元数据，未验证 DOI/出版事实。

应分别评价：来源是否存在、引用 ID 是否指向正确文档、证据是否支持陈述、页码/片段是否准确。一个 URL 可打开并不证明段落结论正确。

## 6. 指标定义与标注需求

先固定检索单位：论文、摘要或 chunk；查询与相关集合使用稳定 ID。设查询 q 的相关集合 Rq，去重后的前 K 个结果 LqK：

- **召回率 Recall@K**：`|Rq ∩ LqK| / |Rq|`。需要 qrels（查询相关性标注）；标准数据可直接用于其定义的论文/摘要粒度，不能自动迁移为项目全文 chunk 真值。
- **精确率 Precision@K**：`|Rq ∩ LqK| / K`。少于 K 条的分母政策需预注册；未标注文档不能无条件当负例。
- **平均倒数排名 Mean Reciprocal Rank，MRR@K**：每查询首个相关结果排名倒数，未命中为 0，然后平均；需规定二元相关阈值。
- **归一化折损累计增益 Normalized Discounted Cumulative Gain，nDCG@K**：按分级相关性计算 `DCG=sum((2^rel_i-1)/log2(i+1))`，除以理想 IDCG，再按查询平均；无相关查询的处理预先规定。
- **引用准确率 Citation Accuracy**：被引用的陈述中，来源/片段确实支持该陈述的比例；需要人工判定或有明确 evidence 的专门数据。不要把参考列表格式通过算准确。
- **忠实度 Faithfulness**：回答的可核验事实陈述有多少得到已提供证据支持；先分解原子陈述，人工校准自动判定。模型互相打分只能辅助。
- **证据覆盖 Evidence Coverage**：预先定义的必需事实/证据单元被检索或回答覆盖的比例；区分 retrieval coverage 与 answer coverage，需要查询级证据标注。

可使用 [BEIR 官方仓库](https://github.com/beir-cellar/beir) 的检索评测与相关性数据格式作为离线基线；[SciFact 官方仓库](https://github.com/allenai/scifact) 提供科学论断、摘要及证据标注。二者不能直接代表本项目中文全文 PDF 引用可靠性。官方资料用于方案参考，本轮未下载/运行数据集，不报告指标。

## 7. 最小评测集与验收顺序

1. **解析层**：固定有许可的真实 PDF 小集，覆盖压缩流、单双栏、字体、扫描和公式；记录文档哈希/版本。人工标正文、阅读顺序、页码及公式；检测空文本、异常耗时和文本污染。先保证终止，再谈抽取质量。
2. **检索层**：冻结 corpus/queries/qrels，先跑全库 BM25，再 Dense，再固定候选的 rerank；每阶段报告 recall/排序指标和失败查询。不要用 Tavily 动态网页作唯一可复现语料。
3. **证据层**：stable doc_id/chunk_id/page/offset/hash，生成时引用这些 ID；程序检查 ID 有效，人工判断支持关系。
4. **生成层**：固定模型、Prompt、输入预算，分别测无检索/检索/重排；事实任务给答案标准，开放任务双人 rubric。报告拒答与无证据降级，不只看非空输出。

上述是下一阶段方案，没有提前生成任何准确率、速度提升或科研结论。
