# 本地复现指南

所有数据库命令都必须显式指向一次性本机测试数据库。不要将 `DATABASE_URL` 或 `DIRECT_URL` 指向开发共享库、真实用户数据库或生产环境。以下过程不会删除数据库。

## 1. 安装并检查主应用

```bash
npm ci
npx tsc --noEmit
npm run lint
npm run test:quality
npm run test:workflow
```

`test:quality` 是普通功能测试白名单。`test:workflow` 按脚本规则跳过 `scopes by userId`；不要为了本轮工程验收运行包含边界/权限专项的测试套件。

## 2. 隔离 PostgreSQL migration 和集成测试

本轮实际使用本机 UTF-8 PostgreSQL 18.6；CI/Compose 配置 PostgreSQL 16，尚无远端运行证据。复现本机结果时建立一个新的空测试库。以下示例假定测试数据库仅绑定回环接口，用户名、端口和库名按本机临时实例调整：

```bash
export DATABASE_URL='postgresql://postgres@127.0.0.1:55446/scholar_upgrade'
export DIRECT_URL="$DATABASE_URL"
export ENCRYPTION_SECRET='0123456789abcdef0123456789abcdef'

npx prisma migrate deploy
npx prisma migrate deploy
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code

SCHOLAR_UPGRADE_TEST_DATABASE=1 npx vitest run --no-file-parallelism \
  src/lib/__tests__/durable-jobs.integration.test.ts \
  src/lib/__tests__/document-index.integration.test.ts \
  src/lib/__tests__/server-chat.integration.test.ts \
  src/lib/__tests__/agent-runtime.integration.test.ts
```

预期：第一次 migration 部署 10 个迁移；第二次 `No pending migrations to apply.`；schema diff 是空迁移；4 个集成测试文件共 17 项通过。集成测试自身还会检查数据库地址必须等于隔离目标 `127.0.0.1:55446/scholar_upgrade`。迁移验收后保留测试数据即可；测试集群可以停止，不要删除或重置数据目录。

## 3. 本机 RAG、构建与浏览器业务流程

```bash
npx vitest run \
  src/lib/__tests__/rerank-gateway.test.ts \
  src/lib/__tests__/academic-rag.test.ts \
  src/lib/tools/__tests__/academic-search-strategy.test.ts

npm run build
```

浏览器测试使用本机已安装 Chrome；若系统使用 Playwright 配套 Chromium，则先安装对应 browser binary。测试内的模型 endpoint 是临时 loopback Mock：

```bash
CI=1 PLAYWRIGHT_CHANNEL=chrome \
AGENT_DURABLE_JOBS=1 NEXT_PUBLIC_AGENT_EXECUTION=server \
OPENAI_API_KEY=local-fixture-key SCHOLAR_UPGRADE_TEST_DATABASE=1 \
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" ENCRYPTION_SECRET="$ENCRYPTION_SECRET" \
npm run test:e2e
```

预期 4 项通过：健康路由、聊天输入草稿、mock API 的 Job 观察刷新、以及真实 Next Route Handler + Worker 访问本地模拟模型服务的 durable Job 闭环。该测试不访问外部模型 API。

## 4. Python SciFact 复核

本地独立 research checkout 默认位于主仓库同级 `../ScholarKernel-reranker`。运行复核不需要 PyTorch：

```bash
python3 -m unittest discover -s ../ScholarKernel-reranker/tests -v
python3 scripts/acceptance/recompute_scifact_evaluation.py ../ScholarKernel-reranker
```

脚本核对原始归档与处理语料 hash、checkpoint hash、五套排序指标、reranker 候选集合及配对 bootstrap。当前复算输出见 `04-ml-reproducibility.md`。已有本地 checkpoint 的离线加载可用 research venv 验证：

```bash
cd ../ScholarKernel-reranker
PYTHONPATH=src HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 .venv/bin/python - <<'PY'
from pathlib import Path
import torch
from model_utils import load_cross_encoder, score_pairs

path = Path("models/checkpoints/scifact-reranker")
tokenizer, model, device = load_cross_encoder(torch.device("cpu"), checkpoint=path)
print(score_pairs([("claim", "synthetic evidence")], tokenizer, model, device, batch_size=1))
PY
```

本轮没有重跑训练或下载模型。若确需从头重训，查看 research repo `README.md` 和 `NOTICE.md`，核对依赖、许可证、模型来源及权重覆盖行为；训练记录对应 `python src/train_reranker.py --epochs 1`，省略参数会使用不同的 2 epoch 默认值。运行完整 PyTorch benchmark 可能需要获取 pinned 公共权重；这不属于本次已验证项目。

## 5. 性能数据边界

`document-index.integration.test.ts` 在隔离 PostgreSQL 上自动测量 100、1,000、5,000 合成 chunk，每档 5 次。查询 p95 是 5 个样本中的最大值；RSS 是 5ms 周期采样值，可能漏掉更短瞬时峰值。具体机器/版本和数据见 `03-academic-rag.md`。它不等价于生产负载、并发、真实文献精度或大型语料容量测试。
