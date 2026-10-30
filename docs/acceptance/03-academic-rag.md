# Phase 5.3：Academic RAG 检索完整性与容量

## 变更与检索路径

本地文档检索原先一次性读取最多 1,000 个 chunk，再在内存中完成 BM25、向量排序及 RRF；超过上限的晚段证据会被遗漏。现在 `searchConversationDocumentChunks` 按稳定的 chunk 主键进行 keyset 分页，每页读取 256 行。查询分两遍扫描：第一遍汇总 BM25 全语料文档频率及平均长度，同时对已有向量逐页计算 Dense 分数；第二遍用完整语料统计逐页计算 BM25 分数。两路各保留 28 个候选，再执行 RRF，最终候选不超过请求 topK（默认 8，硬上限 20），并调用可选本地 Reranker。该做法不引入 pgvector 或迁移，内存中不会同时保留完整 chunk 表；代价是 BM25 查询需要对全语料执行两遍页扫描，延迟仍随 chunk 数线性增长。

Dense 查询 embedding 每次请求只生成一次；缺少或版本过期的 chunk embedding 每次最多惰性补录 128 条。Embedding 服务不可用时保留 BM25 结果，本地 Reranker 不可用、返回模型 revision 不符或异常时返回 RRF 结果。检索结果保留稳定 document/chunk ID、实际观察到的页码及模型来源。无页码仍为空值，不推测页码。文档编辑事务替换旧 chunks；测试覆盖旧 chunk 清除。

目前 RRF 去重键为归一化 URL；本地 chunk URL 包含 document 与 chunk 主键，所以仅同一 chunk 会合并，不会把同一文献的不同段落错误折叠。全局来源编号由 `reconcileAcademicSearchSources` 根据归一化来源键重新分配，相关策略有单测覆盖。

## 合成容量测量

在本机隔离 PostgreSQL 18.6（`127.0.0.1:55446/scholar_upgrade`）、Node v22.22.2、macOS arm64 上，以真实 chunk 构建/插入路径及真实 BM25 检索运行 100、1,000、5,000 条合成 chunk。每个规模执行 5 次查询；不配置 embedding 或 reranker 服务。索引时间含 chunk 行生成与数据库批量写入。下表为本次最终隔离集成测试输出，数字只代表此机器、此数据库和此合成数据：

| Chunk 数 | 构建+插入 ms | 查询 p50 ms | 查询 p95 ms | 采样 RSS 增量 p95 |
|---:|---:|---:|---:|---:|
| 100 | 15.44 | 4.60 | 5.36 | 114,688 B |
| 1,000 | 139.35 | 19.67 | 23.03 | 2,179,072 B |
| 5,000 | 650.70 | 80.45 | 87.75 | 7,749,632 B |

阶段 p50（ms）：

| Chunk 数 | 分页读取合计 | BM25 统计 | BM25 排序扫描 | RRF | Reranker | 总查询 |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 3.32 | 0.28 | 0.36 | 0.11 | 0.01 | 4.60 |
| 1,000 | 14.63 | 2.12 | 2.34 | 0.04 | 0.01 | 19.67 |
| 5,000 | 57.24 | 10.51 | 11.45 | 0.06 | 0.01 | 80.45 |

计时重复数为 5，采用 nearest-rank percentile；该样本量下 p95 等于这 5 次中的最大值。RSS 由 5ms 周期采样，报告每次请求采样到的最大值相对基线之差的 p95；短于采样间隔的瞬时峰值可能未捕获，且受进程内存分配器和数据库缓存影响。该测量不是稳定基准，不足以推断大语料容量或生产负载表现。Dense 和 Cross-Encoder 在本轮只有固定 Mock 功能测试，未测量其吞吐或延迟。

## 回归覆盖与证据

- `academic-rag.test.ts` 覆盖纯文本阅读顺序、双栏坐标排序、学术章节边界、长章节分块及未知页码处理；遇到同一文本位于多页时不会编造来源页。
- `rerank-gateway.test.ts` 覆盖中文字符 bigram、分批 BM25 与一次性 BM25 分数一致、配置边界、外部/本地 reranker 降级及版本校验。
- `academic-search-strategy.test.ts` 覆盖来源去重、URL 变体规整、跨批全局引用 ID 与本地 chunk ID 对齐。
- `document-index.integration.test.ts` 使用隔离数据库覆盖真实 API 文档索引、编辑后旧 chunk 清除、无页码 legacy 回填、1,305 chunks 中最后一项中文证据命中、100/1,000/5,000 chunks 性能记录，以及固定本地 embedding/reranker 端点的双路召回和来源 provenance。

本轮执行：

- `SCHOLAR_UPGRADE_TEST_DATABASE=1 ... npx vitest run --no-file-parallelism src/lib/__tests__/durable-jobs.integration.test.ts src/lib/__tests__/document-index.integration.test.ts src/lib/__tests__/server-chat.integration.test.ts src/lib/__tests__/agent-runtime.integration.test.ts`：4 个文件、17 项通过；其中 document-index 5 项。
- `npx vitest run src/lib/__tests__/rerank-gateway.test.ts src/lib/__tests__/academic-rag.test.ts src/lib/tools/__tests__/academic-search-strategy.test.ts`：3 个文件、35 项通过。
- 基准原始输出在本机忽略目录 `node_modules/.cache/rag-benchmark.log`；测试每次执行都会打印合成报告。

## 已知边界

- 分页消除了固定 1,000 条的截断，但查询仍须扫描整个会话文档语料两次。没有对超大语料设置硬 chunk 数限制或后台持久倒排索引；超过本次 5,000 条测试规模的容量、并发、长尾延迟和数据库负载未验证。
- 向量检索要求显式配置本地 embedding provider，且只比较匹配的模型和 revision；当前 128 条惰性补录预算意味着一次请求不保证补齐全库。没有 PostgreSQL vector index，向量仍逐行读出后在应用内计算。
- Cross-Encoder 时延在未配置服务的 BM25 基准中接近空操作；真实本地模型的质量/时延、本地显存/内存占用均未测。
- PDF 扫描件/OCR、带复杂阅读顺序的特殊排版、超出 parser 支持边界的文件、非常大的语料及跨会话检索未由此阶段扩展；请结合现有 PDF 限制继续评估。
- 合成检索准确命中只证明固定 fixture 的路径行为，不代表真实论文数据的检索相关性或答案支持率。
