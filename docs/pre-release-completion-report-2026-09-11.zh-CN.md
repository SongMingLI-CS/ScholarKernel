# ScholarKernel 预发布改造与验收报告

日期：2026-09-11  
代码分支：`fix/production-closure`  
目标仓库：`SongMingLI-CS/ScholarKernel`

## 一、结论

本轮工作已经把 ScholarKernel 从原先包含演示性降级路径的项目，推进为具备真实数据库、私有对象存储、持久化 Agent Job、文献索引和混合检索能力的完整预发布候选版本。项目不是“空壳加模拟数据”：迁移、PDF 上传下载、异步解析、BM25 检索、Job 恢复、节点取消、历史数据兼容和管理员索引运维均已在真实 staging 资源上验证。

当前仍不能宣称完整生产就绪。唯一未通过的硬门禁是 Vercel AI Gateway 的真实向量嵌入：应用和独立 API Key 均收到 `403 customer_verification_required`。这属于 Vercel 团队账户验证问题，不是仓库代码、模型名称、请求格式或 OIDC 捕获错误。完成团队客户验证后，必须重新执行严格向量验收并通过，才能切换稳定 staging 别名并批准正式发布。

## 二、已经完成的工程改造

### 1. 数据库与混合 RAG 基础设施

- 增加并应用 pgvector 相关迁移，文献 chunk 使用 1,536 维向量。
- 创建局部 HNSW 余弦索引，并保留无向量 chunk 的兼容读取能力。
- 文献解析结果记录文件哈希、解析器版本、chunk 版本、embedding 模型版本和索引时间。
- 实现 BM25、向量召回与 RRF 融合；向量不可用时明确降级为 BM25，而不是伪装成混合检索成功。
- 增加标题、摘要、正文的差异化 BM25 权重，以及按问题长度动态调整的候选数和融合参数。
- 改进中文与中英文混合查询处理，并对正文、表格、公式和参考文献采用不同 chunk 策略。

### 2. 文献上传、解析与索引生命周期

- 上传文件写入私有对象存储，不再依赖浏览器本地路径或演示数据。
- 上传完成后通过持久化 Job 异步执行解析和索引。
- 支持失败重试、手动重新索引和内容未变化时跳过重复解析/嵌入。
- 修复 PDF operator 循环可能无法终止的问题。
- 修复二进制图片或附件流被误当正文分词的问题。
- 增加 FlateDecode 压缩 PDF 回归覆盖和解析资源上限。
- 删除文献时同步删除数据库记录与私有对象，并验证下载端点返回 404。

### 3. 长任务和 Agent DAG 可靠性

- Job 和节点状态写入 PostgreSQL，浏览器 SSE 断开不会取消后台任务。
- 重连和页面刷新可按同一 Job ID 恢复或重放最终结果。
- 长节点执行期间周期性刷新 heartbeat 和租约。
- 进程退出后，过期租约可以被另一实例原子回收并继续执行。
- 使用条件更新保护终态，避免迟到完成覆盖 `cancelled`，也避免迟到取消覆盖 `done`。
- 强化幂等 Job claim，降低并发重复执行风险。
- post-response 文献索引记录明确状态和失败原因，并接受平台生命周期实测。

### 4. 索引运维体验

- Library UI 展示 `pending`、`ready`、`degraded`、`failed` 状态。
- 提供“重新索引”和“失败重试”操作。
- 展示 chunk 数、embedding 模型版本、最近索引时间和失败摘要。
- 增加管理员全局历史文献扫描接口，支持游标分页、批量上限和跨用户按实际所有者调度。
- 管理员接口采用显式用户 allowlist，未配置时默认拒绝。
- embedding 支持批次大小、速率、重试次数和退避参数。

### 5. 可观测性

- 记录 BM25、向量召回和融合检索耗时。
- 记录候选数量、最终证据数量、检索模式和降级原因。
- 记录节点排队、运行、重试、恢复和失败分类。
- 记录 DAG 最大并发和租约恢复次数。
- 记录 embedding 请求数、估算 token、chunk 数、耗时和结果状态。
- 指标不记录文献正文、API Key 或 provider 原始错误响应。

### 6. 安全与发布门禁

- Provider 和搜索凭据只从服务端环境或加密设置读取。
- Agent API 拒绝浏览器提交 `runtimeKeys`。
- 服务端文献读取增加所有权校验。
- 增加浏览器产物凭据扫描，防止 API Key、数据库 URL 或 Blob token 进入客户端 bundle。
- staging 脚本具有环境确认、目标主机校验、失败清理和严格向量开关。
- `--require-vector` 只有在 embedding 状态为 ready、模型版本存在，并且查询实际返回向量证据时才会通过。

## 三、真实 staging 验收证据

### 1. Neon 和迁移

- staging clone 的 9 个迁移全部处于 current 状态。
- Neon 成功启用 pgvector 0.8.6。
- 数据库接受 `vector(1536)` 字段和局部 HNSW cosine 索引。
- `EXPLAIN (FORMAT JSON)` 确认查询使用 HNSW `Index Scan`。
- 3,000 个 1,536 维向量、10 个 top-10 查询的参数实测中，当前 `m=16`、`ef_construction=64`、`ef_search=40` 达到 Recall@10 1.0，并获得本轮最低平均远程往返延迟。

### 2. 大 PDF 生命周期

- 使用真实、有效的 48 页 Flate 压缩 PDF，文件大小约 1.52 MB。
- 上传返回 201，并进入 pending 索引状态。
- 私有对象下载结果与上传字节完全一致。
- 异步索引 Job 到达 done，文献标记内容可被检索。
- 对相同内容重新索引时返回“索引已是最新”，未重复执行解析和嵌入。
- 删除后数据库记录和私有对象均不可访问。
- 每次失败验收均执行 finally 清理；最终 smoke 文档数和 staging 用户文档总数均为 0。

### 3. 断线、刷新、进程退出与取消

- SSE 断开后 Job 在 Neon 中继续运行。
- 重连完成同一 Job，第二次连接可重放持久化的 done 结果。
- 多节点运行中取消后，Job 与节点保持稳定 `cancelled`。
- 实际 worker 进程收到 SIGINT 后 heartbeat 停止；租约过期后，另一 Preview 实例回收同一 Job 并完成。

### 4. 历史数据兼容

- 迁移前存在的 1 条 Document 和 217 条 DocumentChunk 可继续读取。
- 3 条没有 `dependsOn` 的旧 checkpoint 可继续读取。
- 4 条旧 AgentNode 可继续读取。
- 旧文献没有 embedding 时走明确 BM25 降级，不会导致读取失败。

### 5. RAG 评测

评测集扩大到 130 个学术问题，覆盖精确术语、同义表达、中查英、跨段落、多文档冲突、页码引用和无答案问题。

- Recall@5：0.975
- Recall@10：0.975
- MRR：0.975
- 检索证据覆盖率：0.975
- 引用绑定答案证据覆盖率：0.975
- 错误 top-1 引用率：0.025
- 无答案引用率：0
- 引用元数据命中率：1.0
- 人工标注 top-1 相关率：0.975

这些指标衡量确定性的检索和引用选择，不等同于开放式 LLM 文本质量评分。

## 四、本地质量门禁

- Vitest：87 个测试文件、434 项测试通过。
- Next.js production build：通过。
- ESLint：通过。
- TypeScript `tsc --noEmit`：通过。
- Prisma schema validation：通过。
- 客户端 bundle 扫描：81 个文件，0 个凭据特征命中。
- Git diff whitespace 检查：通过。

## 五、尚未完成的发布门禁

测试部署已经显式配置 Vercel AI Gateway 地址，并使用 `openai/text-embedding-3-small`。请求级 OIDC token 在上传请求中捕获后传递给 post-response 索引任务。

严格验收中的 PDF 上传、字节一致下载和词法索引均通过，但真实 embedding 请求返回 `EmbeddingHttpError:403`。随后使用新建、限额且短期有效的独立 AI Gateway API Key 执行最小 embedding 探针，仍返回：

```text
403 customer_verification_required
```

该结果证明阻塞发生在 Vercel 团队账户层。测试密钥均已删除，未向仓库或客户端写入任何凭据。

发布前必须完成以下动作：

1. 由 Vercel 团队所有者完成 AI Gateway 客户验证。
2. 重新部署或确认现有 Preview 已获得验证后的 Gateway 权限。
3. 重新执行 `smoke-staging-release.mjs --run --library-only --require-vector`。
4. 确认文献 `embeddingStatus=ready`、模型版本存在、chunk 含真实向量。
5. 确认查询返回 `retrievalMode=hybrid` 且 `vectorEvidenceCount > 0`。
6. 通过后再把稳定 staging 别名切换到新部署。

## 六、发布建议

当前版本可作为功能完整的预发布候选版本推送和评审，也可以在明确标注“向量检索暂时降级为 BM25”的受控内部环境使用。未完成 Vercel 客户验证和严格向量门禁之前，不建议宣布完整生产上线，也不建议把 BM25 降级结果计作混合 RAG 已验收。

详细英文证据记录见 [`staging-acceptance-2026-09-11.md`](./staging-acceptance-2026-09-11.md)。
