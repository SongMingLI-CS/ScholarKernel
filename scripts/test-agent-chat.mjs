/**
 * Agent 对话交互冒烟测试（Node 端直接调用 AgentExecutor）
 * 用法: node scripts/test-agent-chat.mjs
 */
import { config } from "dotenv"
config({ path: ".env.local" })

const { AgentExecutor, isDirectChatInput } = await import("../src/lib/agent-executor.ts")

const cases = [
  { label: "direct-chat 分流", input: "你好", expectDirect: true },
  { label: "workflow 分流", input: "请检索量子计算最新论文并写一份综述", expectDirect: false },
]

console.log("=== 路由分流测试 ===")
for (const c of cases) {
  const direct = isDirectChatInput(c.input)
  const ok = direct === c.expectDirect
  console.log(`${ok ? "✓" : "✗"} ${c.label}: "${c.input.slice(0, 30)}" → ${direct ? "DIRECT_CHAT" : "WORKFLOW"} (期望 ${c.expectDirect ? "DIRECT" : "WORKFLOW"})`)
}

async function tryRun(label, userInput, provider) {
  console.log(`\n=== ${label} ===`)
  console.log(`Provider: ${provider.providerId} / ${provider.model}`)
  const executor = new AgentExecutor(
    {
      activeProvider: provider,
      inference: { temperature: 0.3, maxTokens: 512, contextLimit: 8000 },
      runtimeKeys: {},
      getChatHistory: () => [],
    },
    {
      onDirectChatStream: (text) => process.stdout.write("."),
      onNodeLog: (id, line) => console.log(`  [${id}] ${line}`),
      onNodePatch: (id, patch) => {
        if (patch.status) console.log(`  node ${id} → ${patch.status}`)
      },
    }
  )

  const started = Date.now()
  try {
    const { final, nodes, sources } = await executor.run(userInput)
    const ms = Date.now() - started
    console.log(`\n✓ 完成 (${ms}ms)`)
    console.log(`  节点数: ${nodes.length}, 来源数: ${sources.length}`)
    console.log(`  回复预览: ${final.slice(0, 200).replace(/\n/g, " ")}${final.length > 200 ? "…" : ""}`)
    return { ok: true, final, ms }
  } catch (e) {
    const ms = Date.now() - started
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`\n✗ 失败 (${ms}ms): ${msg}`)
    return { ok: false, error: msg, ms }
  }
}

// 1) Ollama 本地（若可用）
const ollamaResult = await tryRun("Ollama 直连对话", "你好", {
  providerId: "ollama",
  model: "llama3.1",
  baseUrl: "http://localhost:11434",
})

// 2) 若 Ollama 不可用，尝试 DeepSeek（需 .env.local 中的 DEEPSEEK_API_KEY）
if (!ollamaResult.ok) {
  const dsKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (dsKey) {
    await tryRun("DeepSeek 直连对话", "你好，用一句话介绍 ScholarKernel", {
      providerId: "deepseek_openai_compat",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
    })
  } else {
    console.log("\n⚠ Ollama 未运行且无 DEEPSEEK_API_KEY，跳过真实 LLM 调用测试")
  }
}

// 3) Workflow 路径（需 LLM + 可选 Tavily）
const dsKey = process.env.DEEPSEEK_API_KEY?.trim()
const tavilyKey = process.env.TAVILY_API_KEY?.trim()
if (dsKey) {
  console.log("\n=== Workflow 任务规划 + 执行 ===")
  const executor = new AgentExecutor(
    {
      activeProvider: {
        providerId: "deepseek_openai_compat",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com/v1",
      },
      inference: { temperature: 0.3, maxTokens: 1024, contextLimit: 16000 },
      runtimeKeys: { deepseek: dsKey, tavily: tavilyKey },
      search: { tavilyApiKey: tavilyKey },
      getChatHistory: () => [],
    },
    {
      onWorkflowPlanned: (nodes) => console.log(`  规划 ${nodes.length} 个节点: ${nodes.map((n) => n.type).join(" → ")}`),
      onNodeLog: (id, line) => console.log(`  [${id}] ${line.slice(0, 100)}`),
      onNodePatch: (id, patch) => {
        if (patch.status) console.log(`  node ${id} → ${patch.status}`)
      },
    }
  )
  try {
    const started = Date.now()
    const { final, nodes, sources } = await executor.run("请检索一篇关于 attention mechanism 的经典论文并总结要点")
    console.log(`✓ Workflow 完成 (${Date.now() - started}ms)`)
    console.log(`  节点: ${nodes.length}, 来源: ${sources.length}`)
    console.log(`  回复预览: ${final.slice(0, 300).replace(/\n/g, " ")}…`)
  } catch (e) {
    console.log(`✗ Workflow 失败: ${e instanceof Error ? e.message : e}`)
  }
} else {
  console.log("\n⚠ 无 DEEPSEEK_API_KEY，跳过 Workflow 测试")
}

console.log("\n=== 测试结束 ===")
