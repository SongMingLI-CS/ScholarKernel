<div align="center">

# ScholarKernel

**下一代基于分布式智能体图编排与云原生 Serverless 架构的高并发学术 RAG 与协同评审平台**

*Next-Gen Academic RAG & Collaborative Review Platform — Distributed Agent Graph Orchestration on Serverless Edge*

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=for-the-badge&logo=prisma&logoColor=white)](https://www.prisma.io/)
[![Neon PostgreSQL](https://img.shields.io/badge/Neon-PostgreSQL-00E599?style=for-the-badge&logo=postgresql&logoColor=white)](https://neon.tech/)
[![Upstash Redis](https://img.shields.io/badge/Upstash-Redis-00E9A3?style=for-the-badge&logo=redis&logoColor=white)](https://upstash.com/)
[![DeepSeek-R1](https://img.shields.io/badge/DeepSeek--R1-Reasoning-0052FF?style=for-the-badge)](https://www.deepseek.com/)
[![Tests](https://img.shields.io/badge/Tests-283%20Passed-22C55E?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![License](https://img.shields.io/badge/License-Private-lightgrey?style=for-the-badge)](https://github.com/SongMingLI-CS/ScholarKernel)

[English](#english-quick-reference) · [快速启动](#-快速启动) · [架构拓扑](#-架构拓扑) · [功能矩阵](#-核心技术护城河-features-matrix) · [Issues](https://github.com/SongMingLI-CS/ScholarKernel/issues)

</div>

---

> ### 🎬 **Core Loop Demo — 10s Golden Showcase**
>
> ```
> ┌─────────────────────────────────────────────────────────────────────────────┐
> │  [ GIF PLACEHOLDER — 录制后替换为 docs/demo-core-loop.gif ]                  │
> │                                                                             │
> │  ① 乐观秒出：UUID 影子对话即时渲染，输入锁 0ms 解除                          │
> │  ② 拓扑图 R1 赛博终端：ThinkingAgentNode 流式打字机 + 思考流双轨分流         │
> │  ③ Canvas 三线表：TipTap 学术 Markdown 实时渲染评审报告                      │
> │  ④ PDF 精准跳转：点击 [Page N] → 双栏 PDF 平滑滚动 + 2s 绿色脉冲高亮         │
> └─────────────────────────────────────────────────────────────────────────────┘
> ```
>
> *Upload your 10-second core-loop GIF to `docs/demo-core-loop.gif` and uncomment the image below:*
>
> <!-- ![ScholarKernel Core Loop](docs/demo-core-loop.gif) -->

---

## 概述 · Overview

**ScholarKernel** 是一套面向学术场景的全栈多智能体 SaaS 平台：从 DeepSeek-R1 原生思考流渲染、React Flow 分布式 Agent 拓扑编排，到 Canvas / PDF 双模态协同阅读、跨会话文献库与公网只读分享——全链路已在 **283 项 Vitest 单测** 下验证通过，可直接部署至 Vercel + Neon + Upstash 生产环境。

| 维度 | 能力 |
|------|------|
| **Agent 编排** | 多节点工作流 · 断点续跑 · 节点级局部重试 |
| **推理引擎** | DeepSeek-R1 思考流双轨解析 · 多 Provider 网关 |
| **交互体验** | 乐观 UI 零延迟 · 429 限流自愈回滚 |
| **学术产出** | Scholar Canvas · PDF Co-Reader · 页码引用锚定 |
| **资产沉淀** | My Library 跨会话文献库 · Template Hub 预设工坊 |
| **协作分发** | 256-bit 公网分享令牌 · 匿名只读沙箱 |

**Canonical Repository:** [SongMingLI-CS/ScholarKernel](https://github.com/SongMingLI-CS/ScholarKernel)

---

## 🛡 核心技术护城河 · Features Matrix

### 1 · 🧠 DeepSeek-R1 思考流原生内嵌渲染

自研 [`r1-stream-parser`](src/lib/r1-stream-parser.ts) **双轨增量分流引擎**，在 SSE 流式增量中精准隔离 ``<think>`` 标签，将 `thinkingText` 与 `finalResponse` 物理分离。

定制 React Flow [`ThinkingAgentNode`](src/components/nodes/ThinkingAgentNode.tsx) 暗黑赛博终端 UI：流式打字机高亮、触底自动滚动、思考完成态切换——确保 Scholar Canvas 报告区 **100% 纯净**，不含任何推理链泄露。

```typescript
// r1-stream-parser.ts — 双轨状态机
export type R1StreamSnapshot = {
  track: "response" | "thinking"
  thinkingText: string
  finalResponse: string
  thinkingComplete: boolean
}
```

---

### 2 · ⚡ 全链路「乐观更新」零延迟交互

[`optimistic-ui`](src/lib/optimistic-ui.ts) 模块驱动客户端 **UUID 影子数据** 强制提前渲染：

- 新建对话 → `temp_conv_{uuid}` 即时写入侧边栏
- 发送消息 → `temp_msg_{uuid}` 气泡秒出，工作区清空并解除输入锁
- 后台静默与 Neon PostgreSQL 对账 → `reconcileConversationList` 替换真实 ID
- 网络恶化 / 429 → `rollbackConversationList` 自动回滚，琥珀色 Toast 告警

**物理体感延迟：0ms。**

---

### 3 · 🛡 Upstash Redis 边缘无服务器限流阀

[`ratelimit.ts`](src/lib/ratelimit.ts) + [`middleware.ts`](src/middleware.ts) 在 **Vercel Edge Runtime** 构筑滑动窗口限流闸：

| 参数 | 值 |
|------|-----|
| 算法 | Upstash `Ratelimit.slidingWindow` |
| 阈值 | **15 次 / 分钟** |
| 作用域 | Core Write API（新建对话 · 发消息 · Agent 触发） |
| Key 策略 | `user:{sub}` 优先，回退 `ip:{clientIp}` |

请求在触及 Neon DB **之前** 即被 429 熔断；前端 [`api-fetch`](src/lib/api-fetch.ts) 联动拦截并触发乐观 UI 局部回滚。

---

### 4 · 🔄 节点级局部重试与状态自愈状态机

扩展 PostgreSQL [`AgentNode`](prisma/schema.prisma) 模型，持久化中间成果增量快照：

```prisma
model AgentNode {
  id           String   @id @default(cuid())
  jobId        String
  nodeId       String
  status       AgentJobStatus
  outputs      Json?
  nodeSnapshot Json?    // 完整执行上下文快照
  @@unique([jobId, nodeId])
}
```

[`node-resume.ts`](src/lib/agent/node-resume.ts) 实现 `targetNodeId` 续跑判定：自动汇聚前序 `results` 缓存，出错智能体 **就地唤醒**，终结黑盒全量重跑。

---

### 5 · 📄 PDF 沉浸式双栏对照与引用语义锚定

[`PdfCoReader`](src/components/PdfCoReader.tsx) 重构右侧画板为 **Canvas / PDF Twin-Panel** 双模态布局。

[`page-citation`](src/lib/page-citation.ts) 正则解析管道识别 `[p.4]`、`[Page 4]`、`data-page="N"` 等引用格式；[`CitationAnchor`](src/components/CitationAnchor.tsx) 组件挂载点击事件：

> 点击 Canvas 或聊天流中的 `[Page N]` → PDF 视窗 **0 延迟** 平滑滚动至对应页 → **2 秒绿色脉冲高亮** 闪烁。

---

### 6 · 🍱 学术场景工坊与预设全景编排 · Template Hub

[`template-hub`](src/lib/template-hub.ts) + [`presets.ts`](src/config/presets.ts) 构建 Bento Grid 画廊，内置三大预设 DSL 资产：

| 预设 ID | 名称 | 编排 |
|---------|------|------|
| `neurips-peer-review` | 顶会双盲评审模拟器 | Reviewer #1 · #2 并行 → Area Chair 裁决 |
| `nsfc-grant-audit` | 国自然本子致命缺陷挖掘机 | 技术路线 · 科学问题 · 创新性多维挑刺 |
| `sci-revision-assistant` | SCI 大修润色与反驳助手 | 审稿意见解析 → 逐条反驳 → 润色重写 |

一键启动自动继承模板标题、初始 Agent 拓扑与运行状态。

---

### 7 · 📚 中心化跨会话文献资产管理库 · My Library

解耦单一会话绑定，[`Document`](prisma/schema.prisma) 模型直连 `User` 表：

```prisma
model Document {
  userId  String
  @@index([userId])   // 高速用户级索引
}
```

[`my-library`](src/lib/my-library.ts) + [`MyLibraryPanel`](src/components/my-library-panel.tsx) 提供文件夹分类树与卡片网格，支持跨会话多选复用、合流投喂 Agent Run。

---

### 8 · 🔗 一键公网免密只读分享沙箱 · Public Share Link

[`public-share.ts`](src/lib/public-share.ts) 采用 **256-bit `randomBytes(32)` base64url** 安全令牌；[`middleware-auth`](src/lib/middleware-auth.ts) 白名单精准放行 `/share/*` 与 `/api/public/*` 匿名访问。

公开承载页 [`public-share-page`](src/components/public-share-page.tsx) 采用极简宽屏只读模式，锁定 TipTap 编辑状态并悬浮专属商业挂件。

---

## 🧱 技术栈 · Tech Stack

| 层级 | 技术 | 职责 |
|------|------|------|
| **Runtime** | Next.js 16 (App Router) · React 19 | SSR / RSC / Edge Middleware |
| **UI** | Tailwind CSS 4 · shadcn/ui · Lucide React · Framer Motion | 设计系统 · 动效 |
| **Agent 拓扑** | React Flow 11 · Zustand 5 | 可视化工作流 · 全局状态 |
| **编辑器** | TipTap 3 (Table / StarterKit) | Scholar Canvas 富文本 |
| **AI 网关** | Vercel AI SDK 6 · DeepSeek-R1 | 多 Provider 推理 · 思考流 |
| **ORM / DB** | Prisma 7 · Neon PostgreSQL | 关系持久化 · Serverless Pool |
| **缓存 / 限流** | Upstash Redis · @upstash/ratelimit | Edge 滑动窗口限流 |
| **认证** | NextAuth.js 5 (JWT · GitHub · Credentials) | 影子用户 · 路由守卫 |
| **测试** | Vitest 3 · Playwright | 283 单元测试 · E2E |

---

## 📐 架构拓扑 · Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              用户端 UI (Browser)                              │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐   │
│  │ Chat Panel  │  │ Topology View│  │ Scholar     │  │ PdfCoReader      │   │
│  │ + 乐观 UI   │  │ ThinkingNode │  │ Canvas      │  │ Twin-Panel       │   │
│  └──────┬──────┘  └──────┬───────┘  └──────┬──────┘  └────────┬─────────┘   │
└─────────┼────────────────┼─────────────────┼──────────────────┼─────────────┘
          │                │                 │                  │
          ▼                ▼                 ▼                  ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Vercel Edge Middleware (Edge Runtime)                     │
│  ┌────────────────────────────┐    ┌─────────────────────────────────────┐   │
│  │ Upstash Redis 滑动窗口限流  │───▶│ NextAuth JWT 影子用户校验            │   │
│  │ 15 req/min · 429 熔断      │    │ /share/* · /api/public/* 白名单放行  │   │
│  └────────────────────────────┘    └─────────────────────────────────────┘   │
└──────────────────────────────────┬───────────────────────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
┌──────────────────┐   ┌───────────────────────┐   ┌──────────────────────┐
│ /api/conversations│   │ /api/agent/run        │   │ /api/canvas · /docs  │
│ 对话 CRUD · 消息  │   │ AgentExecutor         │   │ Canvas · Library     │
└────────┬─────────┘   │ · node-resume 续跑     │   │ · Public Share       │
         │             │ · r1-stream-parser    │   └──────────┬───────────┘
         │             └───────────┬───────────┘              │
         │                         │                          │
         └─────────────────────────┼──────────────────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │     Neon PostgreSQL (Pool)    │
                    │  User · Conversation · Agent  │
                    │  Job · AgentNode · Document   │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │   DeepSeek-R1 / Multi-LLM    │
                    │   SSE 思考流 → Canvas 渲染    │
                    │   [Page N] → PDF 页码跳转     │
                    └──────────────────────────────┘
```

**数据流向：** 用户操作 → Edge 限流（0ms 冷启动熔断）→ JWT 鉴权 → Route Handler → AgentExecutor 状态机 → Neon 持久化 ↔ DeepSeek-R1 推理 → Canvas / PDF 联动回显。

---

## 🚀 快速启动 · Quick Start

### 环境要求

- Node.js 20+
- PostgreSQL 实例（推荐 [Neon](https://neon.tech/) Serverless）
- Upstash Redis 实例（生产限流，本地可跳过）
- DeepSeek API Key（R1 推理）

### 1 · 克隆与安装

```bash
git clone https://github.com/SongMingLI-CS/ScholarKernel.git
cd ScholarKernel
npm install
```

### 2 · 环境变量配置

复制 `.env.example` 为 `.env.local` 并填写：

```bash
cp .env.example .env.local
```

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `DATABASE_URL` | ✅ | Neon **Pooler** 连接串（`-pooler` 后缀） |
| `DIRECT_URL` | ✅ | Neon **直连** 串（Prisma 迁移 / CLI） |
| `ENCRYPTION_SECRET` | ✅ | 32 字节 AES 密钥；生产环境强制校验 |
| `NEXTAUTH_SECRET` / `AUTH_SECRET` | 建议 | NextAuth JWT 签名密钥 |
| `UPSTASH_REDIS_REST_URL` | 生产 | Upstash Redis REST 端点 |
| `UPSTASH_REDIS_REST_TOKEN` | 生产 | Upstash Redis REST Token |
| `DEEPSEEK_API_KEY` | ✅ | DeepSeek-R1 推理 API Key |
| `OPENAI_API_KEY` | 可选 | OpenAI / 兼容网关 |
| `ANTHROPIC_API_KEY` | 可选 | Claude 系列 |
| `GOOGLE_API_KEY` | 可选 | Gemini 系列 |
| `TAVILY_API_KEY` / `SERPER_API_KEY` | 可选 | 学术检索增强 |
| `GITHUB_ID` / `GITHUB_SECRET` | 可选 | GitHub OAuth 登录 |
| `AUTH_PASSWORD` | 可选 | 启用应用级登录门禁 |
| `PROXY_ACCESS_TOKEN` | 公开部署 | LLM Proxy 网关鉴权 |

生成生产密钥：

```bash
openssl rand -base64 32
```

> **Neon 连接规范：** `DATABASE_URL` 使用带 `-pooler` 的连接串以适配 Serverless 冷启动；`DIRECT_URL` 用于 `prisma migrate` 等需要直连的操作。

### 3 · 初始化数据库

```bash
npm run db:push      # 同步 Prisma Schema → PostgreSQL
```

### 4 · 启动开发服务器

```bash
npm run dev          # http://localhost:3000  (Turbopack)
```

### 5 · Docker 部署（可选）

```bash
cp .env.example .env
docker compose up --build -d
# 应用监听 http://localhost:3000
```

---

## ✅ 工程质量 · Engineering Quality

本项目以 **测试驱动** 保障核心链路可靠性：

```bash
npm test             # Vitest — 53 文件 · 283 项单测 · 100% 绿灯
npm run lint         # ESLint 静态分析
npm run build        # prisma generate + next build — 零类型错误编译
```

| 指标 | 状态 |
|------|------|
| **单元测试** | **283 / 283 Passed** ✅ |
| **测试框架** | Vitest 3 |
| **类型检查** | TypeScript strict · `npm run build` 零错误 |
| **E2E** | Playwright（`npm run test:e2e`） |

核心模块测试覆盖：

- `r1-stream-parser` · `optimistic-ui` · `ratelimit` · `node-resume`
- `page-citation` · `public-share` · `my-library` · `template-hub`
- `middleware-auth` · `api-fetch` · Agent Executor 网关

---

## 📁 目录结构 · Project Layout

```
scholarkernel-web/
├── prisma/schema.prisma          # PostgreSQL 数据模型
├── src/
│   ├── app/
│   │   ├── api/                  # Route Handlers
│   │   │   ├── agent/            # Agent 执行网关
│   │   │   ├── conversations/    # 对话 CRUD
│   │   │   ├── canvas/           # Scholar Canvas
│   │   │   ├── documents/        # My Library API
│   │   │   └── public/           # 公网分享 API
│   │   ├── share/[token]/        # 匿名只读分享页
│   │   └── workshop/library/     # 文献库工坊
│   ├── components/
│   │   ├── nodes/ThinkingAgentNode.tsx
│   │   ├── PdfCoReader.tsx
│   │   ├── canvas-editor.tsx
│   │   └── template-hub.tsx
│   ├── lib/
│   │   ├── agent/                # 执行器 · 续跑 · R1 推理
│   │   ├── r1-stream-parser.ts
│   │   ├── optimistic-ui.ts
│   │   ├── ratelimit.ts
│   │   ├── page-citation.ts
│   │   ├── public-share.ts
│   │   └── my-library.ts
│   ├── config/presets.ts         # 学术模板 DSL
│   ├── middleware.ts             # Edge 限流 + Auth 守卫
│   └── store/useAgentStore.ts    # Zustand 全局状态
└── src/lib/__tests__/            # 283 项 Vitest 单测
```

---

## English Quick Reference

**ScholarKernel** is a production-grade, full-stack multi-agent academic review SaaS built on Next.js 16, React 19, Prisma 7, and Neon PostgreSQL — deployable on Vercel with Upstash Redis edge rate limiting.

**Key differentiators:**

1. **DeepSeek-R1 native thinking stream** — dual-track SSE parser isolates reasoning from final output
2. **Optimistic UI** — UUID shadow records, 0ms perceived latency, automatic rollback on failure
3. **Edge rate limiting** — 15 req/min sliding window via Upstash Redis in Vercel Middleware
4. **Node-level retry** — PostgreSQL `AgentNode` snapshots enable `targetNodeId` resume
5. **PDF Co-Reader** — twin-panel Canvas/PDF with semantic `[Page N]` citation anchoring
6. **Template Hub** — one-click academic presets (peer review, grant audit, revision assistant)
7. **My Library** — user-scoped cross-session document assets with folder taxonomy
8. **Public Share** — 256-bit token, anonymous read-only sandbox

```bash
npm install && npm run db:push && npm run dev
npm test    # 283 tests passed
```

---

<div align="center">

**Built with precision. Tested with rigor. Shipped for academia.**

[Report Bug](https://github.com/SongMingLI-CS/ScholarKernel/issues) · [Request Feature](https://github.com/SongMingLI-CS/ScholarKernel/issues)

</div>
