# ScholarKernel 新设备接管记录

记录日期：2026-10-31
项目：`SongMingLI-CS/ScholarKernel`

## 当前结论

已在 Windows 11 上基于远端 Phase 6 建立隔离的 Phase 7 开发 worktree，恢复 Node 22、安装锁文件依赖，并在新建的本机 PostgreSQL 隔离数据库中应用 11 条迁移。核心测试、本地生产构建和浏览器验收均已运行。旧设备提交和独立 reranker 工程没有恢复；没有访问生产环境、真实模型供应商或 GPU 训练。

## 新设备环境

| 项目 | 实际检查结果 |
|---|---|
| 系统 | Windows 11 Home Single Language，build 26100，x64 |
| CPU / 内存 | Intel Core i9-14900HX；31.8 GB RAM |
| 工作盘 | F: 盘当时约 1 TB 可用空间 |
| GPU | CUDA device detected; PyTorch CUDA runtime check passed; model and driver details omitted. |
| 系统 Node | Node 24.11.1 / npm 11.6.2，未修改系统默认值 |
| 项目 Node | Node 22.23.4 / npm 10.9.9，解压在本任务工作区的 `work/toolchains`，没有全局安装 |
| Git / Python | Git 2.51.2；Python 3.12.10 |
| PostgreSQL | 本机 PostgreSQL 18.1；没有 PostgreSQL 16 服务 |
| Docker | Docker Desktop 28.5.2 / Compose 2.40.3 已安装；daemon 未运行，本轮没有启动 Docker |
| WSL2 | 已有 Ubuntu 24.04.4；本轮使用 Windows 原生环境，没有重置或改动 WSL |
| 浏览器 | Google Chrome 158；Playwright 本机 E2E 使用该浏览器 |

项目 Node 压缩包取自 [Node.js v22.23.4 官方归档](https://nodejs.org/en/download/archive/v22.23.4)，SHA-256 为 `cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20`。npm 镜像下载在本机连接重置；通过一次性命令参数改用 npm 官方 registry 后，`npm ci` 成功。没有修改用户 npm 配置或 `package-lock.json`；参数语义见 [npm CLI 配置文档](https://docs.npmjs.com/cli/v10/using-npm/config/)。

## Git 接管

- 远端只读查询成功；确认 `main` 为 `e129eb65e6bcbf6c2df9696c282613a557b672f1`、`phase6-final-reliability-ai-validation` 为 `62055ecc7ced5738866f1b27b0032e3d31c76ba9`。未发现远端 Phase 7 分支。
- Phase 1、Phase 5 和 Phase 6 的实时 refs 均已核对；Phase 7 从 `62055ecc` 建立，没有在 `main` 上开发。
- 当前开发分支：`feature/phase7-engineering-research`。开发工作保存在独立 worktree。
- 旧设备提交 `8c4c3ae425d1b564d4ce8a302ca8b1e7b79c4194` 在远端和现有本地 Git 对象中均不存在，故没有声称恢复该提交。
- 原有 checkout 有未提交和未跟踪用户工作；本轮没有在其中修改或覆盖文件。
- `fix/production-closure` 与 Phase 6 历史分叉，含独立 staging 记录和供应商验证限制；没有合并该分支或搬入其整套代码。

## 依赖与数据库

`npm ci` 安装了锁文件依赖，Prisma Client 7.8.0 已生成。没有创建或覆盖 `.env`，也没有在 shell 配置中保存密钥。

本轮在隔离 PostgreSQL 18.1 cluster 上运行迁移和 E2E，只使用新建的测试数据库。11 条迁移均已应用，migrate status 为 up-to-date，schema parity diff 为空；这些是本地结果，不能代替 PostgreSQL 16 CI 验收。

检查时没有配置真实模型 API key。测试命令使用的 `OPENAI_API_KEY=local-fixture-key`、`ENCRYPTION_SECRET` 均为本机测试占位值，供应商请求由 mock 接管。没有调用真实付费 API。

## 独立研究工程与权重

主仓库文档所指的 `ScholarKernel-reranker` sibling 工程在检查过的项目、Downloads 和 Documents 候选路径中均不存在；GitHub 仓库搜索也没有找到该项目，主仓库没有恢复的 checkpoint 文件。随后在隔离 Python 3.12 venv 安装官方 PyTorch `2.12.0+cu130`，`torch.cuda.is_available()` 返回 `True`，检测到 CUDA 设备（具体型号省略）。CUDA runtime 可用不等于旧模型可用；没有恢复模型代码、数据或权重，本轮仍未做 reranker 推理或训练。

仓库中的 [Phase 6 AI 结果](../phase6/AI_RESULTS.md) 和 [ML 研究记录](../upgrade/ML_RESEARCH.md) 保留了旧设备的评测报告与 checkpoint 哈希。这些是被继承的文字和 artifact 记录，不表示本机重新取得了训练源代码或权重；本轮没有复算那些实验。

## 保留边界

原始未净化提交链保留在本机 archive/phase7-engineering-research-unredacted 分支，没有被覆盖或上传。公开同步分支从 Phase 6 基线重建，已去除机器路径和具体硬件型号并通过本地扫描。推送后的远端 SHA 与 GitHub Actions 结果见 docs/phase7/FINAL_DELIVERY.md 和 docs/phase7/CI_RESULTS.md。
