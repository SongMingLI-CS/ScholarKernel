/**
 * 一次性 DeepSeek 测试（密钥仅通过环境变量 DEEPSEEK_API_KEY 传入，勿写入文件）
 */
import { config } from "dotenv"
config({ path: ".env.local" })

const { AgentExecutor } = await import("../src/lib/agent-executor.ts")

const dsKey = process.env.DEEPSEEK_API_KEY?.trim()
if (!dsKey) {
  console.error("缺少 DEEPSEEK_API_KEY 环境变量")
  process.exit(1)
}

const provider = {
  providerId: "deepseek_openai_compat",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com/v1",
}

async function runTest(label, userInput, hooks = {}) {
  console.log(`\n=== ${label} ===`)
  const executor = new AgentExecutor(
    {
      activeProvider: provider,
      inference: { temperature: 0.3, maxTokens: 512, contextLimit: 12000 },
      runtimeKeys: { deepseek: dsKey, tavily: process.env.TAVILY_API_KEY?.trim() },
      search: { tavilyApiKey: process.env.TAVILY_API_KEY?.trim() },
      getChatHistory: () => [],
    },
    hooks
  )
  const started = Date.now()
  const { final, nodes, sources } = await executor.run(userInput)
  console.log(`耗时 ${Date.now() - started}ms | 节点 ${nodes.length} | 来源 ${sources.length}`)
  console.log("--- 回复 ---")
  console.log(final.slice(0, 800) + (final.length > 800 ? "\n…(截断)" : ""))
  return { final, nodes, sources }
}

try {
  await runTest("DIRECT_CHAT · 你好", "你好", {
    onDirectChatStream: () => process.stdout.write("."),
  })
  console.log("")

  await runTest("DIRECT_CHAT · 学术简答", "用三句话解释 Transformer 的 self-attention 机制")

  await runTest("WORKFLOW · 论文检索", "检索 Attention Is All You Need 论文并总结三个核心贡献", {
    onWorkflowPlanned: (nodes) => console.log("规划:", nodes.map((n) => n.type).join(" → ")),
    onNodeLog: (_id, line) => console.log("  log:", line.slice(0, 100)),
    onNodePatch: (id, p) => {
      if (p.status) console.log(`  ${id} → ${p.status}`)
    },
  })

  console.log("\n✓ 全部测试完成")
} catch (e) {
  console.error("\n✗ 测试失败:", e instanceof Error ? e.message : e)
  process.exit(1)
}
