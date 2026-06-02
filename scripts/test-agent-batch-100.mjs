/**
 * 100+ Agent 对话批量冒烟测试
 * 用法: DEEPSEEK_API_KEY=sk-xxx npx tsx scripts/test-agent-batch-100.mjs
 * 可选: CONCURRENCY=4 TIMEOUT_MS=90000 npx tsx ...
 */
import { config } from "dotenv"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

config({ path: ".env.local" })

const { AgentExecutor, isDirectChatInput } = await import("../src/lib/agent-executor.ts")

const DS_KEY = process.env.DEEPSEEK_API_KEY?.trim()
if (!DS_KEY) {
  console.error("请设置 DEEPSEEK_API_KEY 环境变量")
  process.exit(1)
}

const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.CONCURRENCY ?? 4)))
const TIMEOUT_MS = Math.max(15000, Number(process.env.TIMEOUT_MS ?? 90000))
const TAVILY = process.env.TAVILY_API_KEY?.trim()

const PROVIDER = {
  providerId: "deepseek_openai_compat",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
}

/** @type {Array<{ id: number; category: string; input: string; expectRoute: 'direct' | 'workflow' }>} */
const CASES = []

// ── 直连：问候 / 身份 / 功能询问 / 致谢（与 isDirectChatInput 一致）──
const DIRECT_GREETING = [
  "你好", "您好", "hi", "hello", "在吗", "早上好", "晚上好",
  "你是谁", "你是什么模型", "who are you",
  "你能做什么", "help",
  "谢谢", "好的", "明白了", "再见", "ok",
]
DIRECT_GREETING.forEach((input) => {
  CASES.push({ id: CASES.length + 1, category: "direct_greeting", input, expectRoute: "direct" })
})

// ── 一般知识问答 → WORKFLOW（reasoning）──
const WORKFLOW_QA = [
  "1+1等于几", "地球有几个卫星", "水的化学式是什么",
  "什么是机器学习", "CNN和RNN区别", "过拟合怎么办",
  "贝叶斯定理直觉解释", "梯度下降一句话", "什么是损失函数",
  "Python list和tuple区别", "Git commit和push区别",
  "LaTeX里怎么写分数", "Markdown加粗语法",
  "Transformer为什么重要", "BERT和GPT区别",
  "什么是embedding", "tokenization是什么",
  "交叉验证的作用", "正则化L1和L2",
  "什么是batch norm", "dropout原理",
  "学习率太大有什么问题", "Adam优化器优点",
  "什么是fine-tuning", "zero-shot什么意思",
  "hallucination怎么缓解", "temperature参数作用",
  "prompt engineering三技巧", "RAG是什么",
  "向量数据库用途", "cosine similarity含义",
  "有什么功能",
]
WORKFLOW_QA.forEach((input) => {
  CASES.push({ id: CASES.length + 1, category: "workflow_qa", input, expectRoute: "workflow" })
})

// ── 40 条 WORKFLOW（reasoning，无检索关键词或短规划） ──
const WORKFLOW_REASON = [
  "请详细对比 Adam 与 SGD 的收敛特性并给出选用建议",
  "解释 VAE 与 GAN 的生成机制差异，各举一条适用场景",
  "梳理强化学习中 policy gradient 与 value-based 方法的核心区别",
  "说明 Batch Normalization 在训练与推理阶段的计算差异",
  "分析 LoRA 微调为何能显著降低显存占用",
  "解释 MoE 架构的负载均衡问题及常见解决方案",
  "对比 RAG 与 fine-tuning 在长文档问答中的优劣",
  "描述 Diffusion Model 前向与反向过程各做什么",
  "解释 Multi-Head Attention 为何需要多个 head",
  "分析 LayerNorm 与 BatchNorm 在 Transformer 中的选择原因",
  "说明 KL 散度在 VAE 目标函数中的作用",
  "解释 contrastive learning 中 InfoNCE loss 的直觉",
  "对比 supervised fine-tuning 与 RLHF 的流程差异",
  "描述 beam search 与 greedy decoding 的权衡",
  "解释 positional encoding 为何用 sin/cos 而非可学习向量",
  "分析 label smoothing 对校准与泛化的影响",
  "说明 knowledge distillation 中 teacher-student 温度参数意义",
  "解释 graph neural network 中 message passing 框架",
  "对比 one-stage 与 two-stage 目标检测范式",
  "描述 capsule network 相对 CNN 的动机与局限",
  "解释 federated learning 的隐私与通信挑战",
  "分析 transformer 在视觉任务中的 patch embedding 设计",
  "说明 mixed precision training 的收益与数值风险",
  "解释 early stopping 与 learning rate schedule 如何配合",
  "对比 cross-entropy 与 focal loss 在类别不平衡下的表现",
  "描述 self-supervised pretraining 的常见代理任务",
  "解释 causal mask 在 decoder-only 模型中的作用",
  "分析 scaling law 对算力规划的启示",
  "说明 retrieval-augmented 与 tool-use agent 的架构差异",
  "解释 chain-of-thought 为何提升复杂推理",
  "对比 encoder-decoder 与 decoder-only 架构适用任务",
  "描述 speculative decoding 的加速原理",
  "解释 weight tying 在语言模型中的效果",
  "分析 activation checkpointing 的时空权衡",
  "说明 gradient clipping 何时必要",
  "解释 Wasserstein distance 在 GAN 中的角色",
  "对比 metric learning 中 triplet loss 与 contrastive loss",
  "描述 neural architecture search 的基本搜索空间",
  "解释 test-time augmentation 的收益边界",
  "分析 out-of-distribution 检测的常见方法",
]
WORKFLOW_REASON.forEach((input) => {
  CASES.push({ id: CASES.length + 1, category: "workflow_reasoning", input, expectRoute: "workflow" })
})

// ── 20 条 WORKFLOW + research ──
const WORKFLOW_RESEARCH = [
  "检索 BERT 原始论文并总结 pre-training 任务",
  "检索 ResNet 论文并说明残差连接动机",
  "检索 GPT-3 论文并列出 scaling 相关结论",
  "检索 Diffusion Models 综述并概括 DDPM 思路",
  "检索 Vision Transformer 论文并总结 patch 设计",
  "检索 LoRA 论文并解释低秩适配原理",
  "检索 Chain-of-Thought 论文并给出 prompting 示例",
  "检索 FlashAttention 论文并说明 IO 优化点",
  "检索 DPO 论文并对比 RLHF 流程",
  "检索 RAG 经典论文并描述检索-生成流程",
  "检索 Graph Attention Network 论文并总结 GAT 机制",
  "检索 SimCLR 论文并解释对比学习框架",
  "检索 AlphaFold 相关论文并概括结构预测思路",
  "检索 Word2Vec 论文并说明 skip-gram 目标",
  "检索 Batch Normalization 原始论文并列出训练要点",
  "检索 Dropout 论文并解释 co-adaptation 问题",
  "检索 Adam optimizer 论文并说明一阶二阶矩估计",
  "检索 Transformer 多头注意力并引用原始 arXiv",
  "检索 InstructGPT 论文并总结人类反馈步骤",
  "检索 Mixture of Experts 经典工作并说明路由机制",
]
WORKFLOW_RESEARCH.forEach((input) => {
  CASES.push({ id: CASES.length + 1, category: "workflow_research", input, expectRoute: "workflow" })
})

// ── 10 条边界 / 回归 ──
const EDGE = [
  { input: "你好，今天天气怎么样", expectRoute: "workflow" },
  { input: "用公式写出 softmax 定义", expectRoute: "workflow" },
  { input: "请审查以下代码逻辑是否有 bug: for i in range(10): print(i)", expectRoute: "workflow" },
  { input: "总结上一轮我们讨论的论文", expectRoute: "workflow" },
  { input: "ok", expectRoute: "direct" },
  { input: "什么是 attention mechanism 的 scaled dot-product", expectRoute: "workflow" },
  { input: "帮我读一下 README 里的安装步骤", expectRoute: "workflow" },
  { input: "arxiv.org/abs/1706.03762 讲了什么", expectRoute: "workflow" },
  { input: "搜索一下最新的大模型进展", expectRoute: "workflow" },
  { input: "你好，请用一句话介绍 ScholarKernel", expectRoute: "workflow" },
]
EDGE.forEach(({ input, expectRoute }) => {
  CASES.push({
    id: CASES.length + 1,
    category: "edge",
    input,
    expectRoute: expectRoute,
  })
})

console.log(`共 ${CASES.length} 条用例 | 并发 ${CONCURRENCY} | 超时 ${TIMEOUT_MS}ms`)

function routeOf(input) {
  return isDirectChatInput(input) ? "direct" : "workflow"
}

// 启动前校验：期望路由须与 isDirectChatInput 一致，避免误标
const routePreflight = CASES.filter((tc) => routeOf(tc.input) !== tc.expectRoute)
if (routePreflight.length > 0) {
  console.error("\n路由预期与 isDirectChatInput 不一致（请修正用例后再跑）：")
  for (const tc of routePreflight) {
    console.error(`  #${tc.id} [${tc.category}] expect=${tc.expectRoute} actual=${routeOf(tc.input)} → "${tc.input.slice(0, 60)}"`)
  }
  process.exit(1)
}
console.log("路由预检通过 ✓")

function makeExecutor(category) {
  const needsSearch = category === "workflow_research"
  return new AgentExecutor(
    {
      activeProvider: PROVIDER,
      inference: { temperature: 0.25, maxTokens: needsSearch ? 1024 : 512, contextLimit: 12000 },
      runtimeKeys: { deepseek: DS_KEY, tavily: TAVILY },
      search: needsSearch ? { tavilyApiKey: TAVILY } : undefined,
      getChatHistory: () => [],
    },
    {
      onWorkflowPlanned: () => {},
      onNodeLog: () => {},
      onNodePatch: () => {},
      onDirectChatStream: () => {},
    }
  )
}

async function runOne(tc) {
  const actualRoute = routeOf(tc.input)
  const routeOk = actualRoute === tc.expectRoute

  const started = Date.now()
  let status = "pass"
  let error = ""
  let finalLen = 0
  let nodeCount = 0
  let sourceCount = 0

  try {
    const executor = makeExecutor(tc.category)
    const result = await Promise.race([
      executor.run(tc.input),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), TIMEOUT_MS)
      ),
    ])
    finalLen = (result.final ?? "").trim().length
    nodeCount = result.nodes?.length ?? 0
    sourceCount = result.sources?.length ?? 0
    if (finalLen === 0) {
      status = "empty_reply"
      error = "empty final response"
    }
  } catch (e) {
    status = "error"
    error = e instanceof Error ? e.message : String(e)
  }

  const ms = Date.now() - started
  const pass = status === "pass" && routeOk

  return {
    id: tc.id,
    category: tc.category,
    input: tc.input.slice(0, 80),
    expectRoute: tc.expectRoute,
    actualRoute,
    routeOk,
    status,
    pass,
    ms,
    finalLen,
    nodeCount,
    sourceCount,
    error: error.slice(0, 200),
  }
}

async function poolRun(items, limit) {
  const results = []
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      const r = await runOne(items[i])
      results.push(r)
      const mark = r.pass ? "✓" : "✗"
      process.stdout.write(
        `${mark} #${String(r.id).padStart(3)} [${r.category.slice(0, 12).padEnd(12)}] ${r.ms}ms len=${r.finalLen} route=${r.routeOk ? "ok" : "MISMATCH"}\n`
      )
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()))
  return results.sort((a, b) => a.id - b.id)
}

const startedAll = Date.now()
const results = await poolRun(CASES, CONCURRENCY)
const totalMs = Date.now() - startedAll

const passed = results.filter((r) => r.pass).length
const empty = results.filter((r) => r.status === "empty_reply").length
const errors = results.filter((r) => r.status === "error").length
const routeMismatch = results.filter((r) => !r.routeOk).length
const avgMs = Math.round(results.reduce((s, r) => s + r.ms, 0) / results.length)

const byCategory = {}
for (const r of results) {
  byCategory[r.category] ??= { pass: 0, total: 0, ms: 0 }
  byCategory[r.category].total++
  byCategory[r.category].ms += r.ms
  if (r.pass) byCategory[r.category].pass++
}

const report = {
  summary: {
    total: results.length,
    passed,
    failed: results.length - passed,
    empty_reply: empty,
    errors,
    route_mismatch: routeMismatch,
    pass_rate: `${((passed / results.length) * 100).toFixed(1)}%`,
    total_ms: totalMs,
    avg_ms: avgMs,
    concurrency: CONCURRENCY,
    at: new Date().toISOString(),
  },
  byCategory: Object.fromEntries(
    Object.entries(byCategory).map(([k, v]) => [
      k,
      { pass: v.pass, total: v.total, pass_rate: `${((v.pass / v.total) * 100).toFixed(1)}%`, avg_ms: Math.round(v.ms / v.total) },
    ])
  ),
  failures: results.filter((r) => !r.pass).map((r) => ({
    id: r.id,
    category: r.category,
    input: r.input,
    status: r.status,
    routeOk: r.routeOk,
    expectRoute: r.expectRoute,
    actualRoute: r.actualRoute,
    error: r.error,
    finalLen: r.finalLen,
  })),
  all: results,
}

mkdirSync("scripts/reports", { recursive: true })
const outPath = join("scripts/reports", `agent-batch-${Date.now()}.json`)
writeFileSync(outPath, JSON.stringify(report, null, 2))

console.log("\n========== 汇总 ==========")
console.log(`用例总数: ${results.length}`)
console.log(`通过: ${passed} (${report.summary.pass_rate})`)
console.log(`失败: ${results.length - passed} (空回复 ${empty}, 异常 ${errors}, 路由不符 ${routeMismatch})`)
console.log(`总耗时: ${(totalMs / 1000).toFixed(1)}s | 平均: ${avgMs}ms/条`)
console.log("分类:")
for (const [k, v] of Object.entries(report.byCategory)) {
  console.log(`  ${k}: ${v.pass}/${v.total} (${v.pass_rate}) avg ${v.avg_ms}ms`)
}
console.log(`报告: ${outPath}`)

if (passed < results.length) process.exit(1)
