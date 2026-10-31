# Phase 7 PyTorch 与 Reranker 研究交接

## 恢复检查

Phase 6 文档预期的 sibling 工程是 `../ScholarKernel-reranker`。在本地项目、Codex workspace、Downloads、Documents、Desktop 候选位置以及 GitHub 仓库搜索均没有找到该工程；主仓库也没有模型 checkpoint。研究脚本、冻结训练数据、模型权重、模型缓存和训练日志均没有在本设备恢复。

本机 GPU 可由驱动识别，nvidia-smi 报告 CUDA 13.3。随后在隔离 Python 3.12 venv 安装官方 PyTorch 2.12.0+cu130；实际检查输出 torch.version.cuda=13.0、torch.cuda.is_available()=True、设备数 1。此检查只验证 PyTorch CUDA runtime 和设备发现，不代表 Cross-Encoder 已加载；因没有研究代码与 checkpoint，本轮没有模型推理或训练。

## 继承记录，不是本轮复现

仓库 [ML_RESEARCH.md](../upgrade/ML_RESEARCH.md) 记载了旧设备流程：SciFact train/dev、1 epoch、每 query 4 个 BM25 未标记困难负例，预训练初始化为 `cross-encoder/ms-marco-MiniLM-L6-v2`。旧文件列出三个 checkpoint 的标识：

| Seed | 文档记录的 checkpoint SHA-256 |
|---:|---|
| 20261030 | `81e76d68e3a50f482ace7dceb72be2d21ef89909eb6933bcbeda0bdca7b104cb` |
| 20261031 | `42a53015938782f16b89fdce130090c422d2c1755fcaf2c78fba1edfaa72d3c0` |
| 20261032 | `24f40f60e8bcae708741b441efbbf9fdc61bdee1f7be0cb25fd0fffdf805cca7` |

这些是已提交文档中的历史哈希，不是本机对文件的复核。旧 checkpoint 和数据没有恢复，不能直接用于服务或继续训练。旧结果与 NFCorpus 语料重叠、SciFact dev 模型选择以及 bootstrap 边界见 [AI_EVALUATION.md](AI_EVALUATION.md)。

## 恢复后可执行的工作

1. 从旧设备 bundle/压缩包恢复独立 repo 到 sibling 目录；先检查 Git 历史和文件列表，不覆盖当前工作树。
2. 校验数据集 SHA、模型 revision、checkpoint SHA 和训练日志；确认许可证与可用范围。
3. 创建独立 venv，按锁定依赖安装，运行 Python 单测和 `compileall`。
4. 代码和 checkpoint 恢复后，在不影响其他 GPU 工作负载的前提下跑最小推理；记录实际设备、输出误差和资源占用，再决定是否训练。
5. 使用冻结的独立评测 split、多个训练 seed 和逐 query artifact；负例实验预先定义候选和指标。
6. 用户 PDF 和中文评测应使用获授权且独立的标注语料；不可用 SciFact dev 替代 test，也不可将检索 nDCG 外推为答案事实性。

当前唯一新增性能数值是主仓库隔离 PostgreSQL 上的 synthetic BM25 查询时间，不属于 PyTorch 或 reranker 实验。
