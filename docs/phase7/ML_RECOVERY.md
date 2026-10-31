# ScholarKernel Reranker 与 PyTorch 恢复验收

日期：2026-10-31

## 结论

独立 ScholarKernel-reranker 工程、数据、训练日志和模型 checkpoint 本轮均未恢复。主仓库可用的 PyTorch CUDA runtime 已安装并能发现本机 GPU，但这不代表 Cross-Encoder 已加载。本轮没有 reranker 推理、训练或新检索评测。

## 搜索与完整性

按交接记录检查了授权工作区、Downloads、Documents、Desktop 的已知候选位置及 GitHub 上可查项目；没有找到 ScholarKernel-reranker、压缩包或 Git bundle。主仓库中没有 models/checkpoints/scifact-reranker、训练产物或可复算的研究数据。下列研究组件仍缺失：

| 组件 | 状态 |
|---|---|
| BM25 / RRF 独立研究实现 | 未恢复 |
| 冻结数据与 data/manifest.json | 未恢复 |
| Cross-Encoder 训练和数据准备脚本 | 未恢复 |
| Benchmark、模型服务、Python 单测 | 未恢复 |
| results JSONL、训练配置与运行日志 | 未恢复 |
| checkpoint 与文件级校验 | 未恢复 |
| 原始工程 NOTICE / attribution 文件 | 未恢复；主仓库 fixture 保留其许可说明 |

历史记录中的 checkpoint SHA-256 为 81e76d68e3a50f482ace7dceb72be2d21ef89909eb6933bcbeda0bdca7b104cb。本轮没有对应文件可供哈希，因此该值只是既有文档记录，不能称为本设备验证通过。没有创建替代权重或伪造恢复结果。

## 新设备 CUDA runtime 检查

本机存在 CUDA 兼容 GPU，驱动侧 nvidia-smi 报告 CUDA 13.3。隔离 Python 3.12 环境安装官方 PyTorch 2.12.0+cu130 后，运行 torch 版本和 CUDA 查询：

    torch=2.12.0+cu130
    built_cuda=13.0
    cuda_available=True
    device_count=1
    device_name=<model omitted>

安装来源为 [PyTorch Get Started Locally](https://pytorch.org/get-started/locally/) 对照 [Previous PyTorch Versions](https://pytorch.org/get-started/previous-versions/) 的官方 Windows/CUDA wheel 说明。仅做设备发现检查；未下载研究模型，未加载 checkpoint，未做训练。安装时 NumPy 未安装并出现可选加速提示，不影响上述 CUDA 检查结果。

## 历史实验，不是本轮复现

仓库旧报告记录 SciFact dev 微调 nDCG@10 0.9050、预训练模型 0.8675；NFCorpus 官方 test 记录三个训练 seed 平均值 0.5589、预训练 0.5501。SciFact dev 用于模型选择；NFCorpus 文档审计发现部分近重复候选，seed 区间也不一致。这些数字均为继承的 Phase 6 报告，当前设备没有重算。细节见 AI_EVALUATION.md 与 docs/phase6/AI_RESULTS.md。

## 恢复后的安全顺序

1. 从可授权的旧设备备份恢复源码副本，不覆盖当前主仓库。
2. 检查 Git 历史、NOTICE、许可证、数据来源与使用条款。
3. 对数据归档、处理数据、配置和所有 checkpoint 分别计算 SHA-256，并与 manifest/训练记录比对。
4. 固定依赖和模型 revision，先跑 Python 单测，再做一批可复现的小型推理并记录设备、时延和输出。
5. 冻结独立评测集与分析方案后，才开展多 seed 训练、负样本对照、逐 query 误差分析。
6. 未经明确授权，不将大型 checkpoint 上传公开仓库。

## 证据位置

- 主仓库历史与边界：docs/phase7/ML_RESEARCH.md、docs/phase7/AI_EVALUATION.md。
- 历史训练与评测程序（若干文件引用 sibling 数据/权重，当前无法复跑）：scripts/acceptance/evaluate_nfcorpus.py、scripts/acceptance/recompute_scifact_evaluation.py、scripts/acceptance/evaluate_nfcorpus_overlap_sensitivity.py。
- CUDA 检查证据：本地隔离环境命令输出；环境未纳入 Git。
