# ScholarKernel 2.0 已知限制

本清单区分已验证的工程边界和未验证的产品效果。完成这些普通工程验收不代表系统具备生产 SLA 或通过安全审计。

## 文档解析与 Academic RAG

- PDF 上传解析上限为 8 MiB，默认 parser deadline 为 15 秒；超限、超时、损坏、不受支持及无法提取文字的 PDF 返回具体错误。扫描图像/空白 PDF 没有 OCR，不能提取其图像文字。
- PDF.js 获取的文本和页面几何可用于栏排序与章节分块；无坐标文本保留原顺序。复杂公式、图表、混合栏和特殊阅读顺序仍可能不完整。页码只有实际映射成功才记录。
- 本地 chunk 查询不再截断 1,000 行，而是每页 256 行对全语料做两遍扫描。BM25 查询延迟仍为线性；当前未使用 pgvector 或持久倒排索引。容量验证止于 5,000 个合成 chunks，不代表生产容量。
- Dense 检索需显式配置本地 embedding provider；向量以 JSON 保存并在应用层逐条计算。单次请求最多惰性重建 128 条缺失/过期向量；不能保证一次补齐超大文献库。Embeddings 与 reranker 未配置/失败时降级结果的质量未在真实语料评估。
- 页面来源 ID 指向稳定 document/chunk ID。旧文本没有真实页码时继续未知；citation-support fixture 中 SciFact 摘要页码为 `null`。
- BM25 与 Dense/RRF 模块测试通过不等于真实上传论文的检索相关性、跨学科召回或生成答案事实性。

## Agent、模型预算和计费

- Durable Job 有数据库 Job/event/checkpoint、worker lease、取消、人工干预和恢复路径；执行语义至少一次。Provider 结果产生后、checkpoint 提交前 Worker 失败，模型调用可能重复；外部调用没有 exactly-once 或跨 retry 的全局调用幂等保障。
- 真实 Next API/Worker 工作流通过本地 Mock OpenAI-compatible endpoint 验证。Browser 的 Job 刷新用例仍 mock API，浏览器网络断连后对真实数据库 Job 的刷新恢复未覆盖。
- 客户端保留浏览器执行路径；并非所有 Agent 请求都统一到服务端 durable Jobs。运行时真实 Provider 超时、取消、重试、Token usage、成本没有验证。
- context limit 使用字符数裁剪，不是准确 tokenizer token 数；Token 与成本以模型/provider 返回 usage 和静态费率为基础，缺 usage/实时价格时不能视为真实账单。

## ML 和生成答案评估

- SciFact 仅为英文 evidence-retrieval dev 评测；188 个有 qrels query 计入，112 个未标注 query 不记分。SUPPORT 与 CONTRADICT 都是“证据文档”正例，不是 claim truth accuracy。
- 微调 checkpoint 已离线加载验证，但权重在独立 sibling research repo 的 ignored 路径，不在当前仓库或 commit 中。从头训练、重跑 dense/cross-encoder 全量 benchmark、不同随机种子均未执行。
- Dev split 用于选择 epoch 和汇报，且 train/dev 仍有高字面近似样本；paired bootstrap 是探索性估计，不能称独立 test 或确认性泛化。
- 未输出 LLM 生成答案；固定 10 条 Citation Support fixture 只是已标注输入。Citation Support Rate、答案事实性、Agent single/multi-agent 对照及生成式消融没有真实结果。
- 真正模型调用、供应商延迟、真实 tokens/成本、中文 SciFact 泛化、用户文档质量均未验证。

## 构建、远端与安全边界

- Next.js 16 production build 通过，但提示 `middleware` 文件约定将弃用；React Flow 浏览器测试有 nodeTypes/edgeTypes 对象重建提示。本轮未触碰 middleware/auth 代码。
- Docker Compose 配置及构建参数解析通过，runner 文件布局下 Worker 启停通过；Docker daemon 不可用，镜像没有构建或启动，未部署。
- CI workflow 配置更新尚未推送，GitHub Actions 没有本轮新 run。本机 PostgreSQL 为 18.6，CI/Compose 配置为 16，不能以本机结果替代该环境验收。
- 既有 `docs/audit/` 记录保留，原审计事项没有在本轮修复或复核。本轮没有运行漏洞扫描、渗透、攻击模拟、认证、权限/租户边界或任何其他主动安全测试。不能因此宣称安全事项已解决或系统适合公开部署。
