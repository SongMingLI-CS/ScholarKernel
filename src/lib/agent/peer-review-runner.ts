import { generateText } from "ai"
import {
  AREA_CHAIR_PERSONA,
  buildPeerReviewCanvasOutput,
  getPersonaById,
  INNOVATION_SCOUT_PERSONA,
  METHODOLOGY_CRITIC_PERSONA,
  type PeerReviewPersonaId,
} from "@/lib/agent/agent-personas"
import type { AgentExecutorDeps, AgentExecutorHooks, SubtaskResult } from "@/lib/agent/executor-types"
import {
  buildGenModelForCloudInference,
  llmCallSettings,
  logLlmCallFailure,
  providerSelfIntro,
} from "@/lib/agent/llm-utils"
import type { WorkflowNode } from "@/lib/agent/planner"

export type PeerReviewGenerateFn = (input: {
  personaId: PeerReviewPersonaId
  systemPrompt: string
  userPrompt: string
}) => Promise<string>

export type PeerReviewDebateFn = (input: {
  methodologyReview: string
  innovationReview: string
}) => Promise<string>

export type ExecutePeerReviewGroupInput = {
  groupNodes: WorkflowNode[]
  userInput: string
  deps: AgentExecutorDeps
  hooks: Pick<AgentExecutorHooks, "onNodePatch" | "onNodeLog">
  generateReview?: PeerReviewGenerateFn
  generateDebate?: PeerReviewDebateFn
}

export function isPeerReviewGroupStart(nodes: WorkflowNode[], index: number): boolean {
  if (nodes[index]?.type !== "peer_review") return false
  return index === 0 || nodes[index - 1]?.type !== "peer_review"
}

export function collectPeerReviewGroup(nodes: WorkflowNode[], startIndex: number): WorkflowNode[] {
  const group: WorkflowNode[] = []
  for (let i = startIndex; i < nodes.length && nodes[i]?.type === "peer_review"; i++) {
    group.push(nodes[i]!)
  }
  return group
}

function resolveSubjectText(userInput: string, groupNodes: WorkflowNode[]): string {
  for (const n of groupNodes) {
    const inp = n.input
    if (inp && typeof inp === "object" && !Array.isArray(inp)) {
      const rec = inp as Record<string, unknown>
      const raw = typeof rec["text"] === "string" ? rec["text"] : typeof rec["abstract"] === "string" ? rec["abstract"] : ""
      if (raw.trim()) return raw.trim()
    }
  }
  return userInput.trim()
}

function personaIdFromNode(node: WorkflowNode, fallback: PeerReviewPersonaId): PeerReviewPersonaId {
  const meta = node.metadata?.personaId
  if (typeof meta === "string" && getPersonaById(meta)) return meta as PeerReviewPersonaId
  return fallback
}

async function defaultGenerateReview(
  deps: AgentExecutorDeps,
  node: WorkflowNode,
  personaId: PeerReviewPersonaId,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const persona = getPersonaById(personaId)
  if (!persona) throw new Error(`UnknownPersona:${personaId}`)

  const active = deps.activeProvider
  const runtimeKeys = deps.getRuntimeKeys?.() ?? deps.runtimeKeys
  const model = buildGenModelForCloudInference(active, runtimeKeys, node)

  const { text } = await generateText({
    model,
    system: [providerSelfIntro(active), "", systemPrompt].join("\n"),
    prompt: userPrompt,
    temperature: deps.inference?.temperature ?? 0.35,
    ...llmCallSettings(deps.signal),
  })

  return text.trim()
}

async function runSingleReviewer(
  node: WorkflowNode,
  personaId: PeerReviewPersonaId,
  subject: string,
  deps: AgentExecutorDeps,
  hooks: ExecutePeerReviewGroupInput["hooks"],
  generateReview: PeerReviewGenerateFn,
  nodeStartedAt: number
): Promise<{ node: WorkflowNode; text: string }> {
  const persona = getPersonaById(personaId) ?? METHODOLOGY_CRITIC_PERSONA
  hooks.onNodePatch?.(node.id, { status: "running" })
  hooks.onNodeLog?.(node.id, `${persona.label} 开始独立评审…`)

  const userPrompt = [
    "请对以下投稿内容（摘要 / 实验设计 / 方法描述）进行严格审稿：",
    "",
    "--- SUBMISSION ---",
    subject,
    "--- END ---",
  ].join("\n")

  try {
    const text = await generateReview({ personaId, systemPrompt: persona.systemPrompt, userPrompt })
    hooks.onNodeLog?.(node.id, `${persona.label} 评审完成（${text.length} chars）`)
    hooks.onNodePatch?.(node.id, {
      status: "done",
      output: { text, personaId },
      metadata: { durationMs: Math.round(performance.now() - nodeStartedAt), personaId },
    })
    return { node, text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logLlmCallFailure(`peer-review: ${node.id}`, e)
    hooks.onNodePatch?.(node.id, { status: "error", error: msg })
    throw e
  }
}

export async function executePeerReviewGroup(input: ExecutePeerReviewGroupInput): Promise<SubtaskResult[]> {
  const { groupNodes, userInput, deps, hooks } = input
  const generateReview =
    input.generateReview ??
    ((args) => defaultGenerateReview(deps, groupNodes[0]!, args.personaId, args.systemPrompt, args.userPrompt))

  const generateDebate =
    input.generateDebate ??
    (async ({ methodologyReview, innovationReview }) => {
      const persona = INNOVATION_SCOUT_PERSONA
      return generateReview({
        personaId: "innovation_scout",
        systemPrompt: [
          persona.systemPrompt,
          "",
          "你现在进入激辩环节：Reviewer #1 已提交方法论批判。",
          "请查漏补缺、逐条反驳或承认合理质疑，输出「Debate Response」章节。",
        ].join("\n"),
        userPrompt: [
          "Reviewer #1 的方法论批判：",
          methodologyReview,
          "",
          "你此前的创新点评估：",
          innovationReview,
          "",
          "请给出激辩回应（中文）。",
        ].join("\n"),
      })
    })

  if (groupNodes.length < 3) {
    throw new Error("PeerReviewGroupRequiresThreeNodes")
  }

  const [r1Node, r2Node, r3Node] = groupNodes
  const subject = resolveSubjectText(userInput, groupNodes)
  const groupStartedAt = performance.now()

  hooks.onNodeLog?.(r1Node!.id, "【Peer Review】并行启动 Reviewer #1 & #2…")
  hooks.onNodeLog?.(r2Node!.id, "【Peer Review】并行启动 Reviewer #1 & #2…")

  hooks.onNodePatch?.(r1Node!.id, { status: "running" })
  hooks.onNodePatch?.(r2Node!.id, { status: "running" })

  const r1PersonaId = personaIdFromNode(r1Node!, "methodology_critic")
  const r2PersonaId = personaIdFromNode(r2Node!, "innovation_scout")

  const [r1Out, r2Out] = await Promise.all([
    runSingleReviewer(r1Node!, r1PersonaId, subject, deps, hooks, generateReview, groupStartedAt),
    runSingleReviewer(r2Node!, r2PersonaId, subject, deps, hooks, generateReview, groupStartedAt),
  ])

  hooks.onNodeLog?.(r1Node!.id, "【Debate Stream】Reviewer #1 批判意见已提交，进入激辩…")
  hooks.onNodeLog?.(r2Node!.id, "【Debate Stream】等待 Reviewer #2 回应…")

  const debateText = await generateDebate({
    methodologyReview: r1Out.text,
    innovationReview: r2Out.text,
  })

  const debateLines = debateText.split("\n").filter(Boolean)
  for (const line of debateLines.slice(0, 24)) {
    hooks.onNodeLog?.(r1Node!.id, `[Debate] ${line}`)
    hooks.onNodeLog?.(r2Node!.id, `[Debate] ${line}`)
  }
  hooks.onNodeLog?.(r1Node!.id, "【Debate Stream】激辩回合完成")
  hooks.onNodeLog?.(r2Node!.id, "【Debate Stream】激辩回合完成")

  const r3PersonaId = personaIdFromNode(r3Node!, "area_chair")
  const chairPersona = getPersonaById(r3PersonaId) ?? AREA_CHAIR_PERSONA
  hooks.onNodePatch?.(r3Node!.id, { status: "running" })
  hooks.onNodeLog?.(r3Node!.id, `${chairPersona.label} 汇总 meta-review…`)

  const metaPrompt = [
    "投稿内容：",
    subject,
    "",
    "Reviewer #1（Methodology Critic）意见：",
    r1Out.text,
    "",
    "Reviewer #2（Innovation Scout）意见：",
    r2Out.text,
    "",
    "激辩交锋记录：",
    debateText,
    "",
    "请按顶会 Area Chair 标准输出最终 meta-review（Markdown）。",
  ].join("\n")

  let metaReviewRaw = ""
  try {
    metaReviewRaw = await generateReview({
      personaId: "area_chair",
      systemPrompt: chairPersona.systemPrompt,
      userPrompt: metaPrompt,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logLlmCallFailure(`peer-review: ${r3Node!.id}`, e)
    hooks.onNodePatch?.(r3Node!.id, { status: "error", error: msg })
    throw e
  }

  const canvasWrapped = buildPeerReviewCanvasOutput(metaReviewRaw)
  const durationMs = Math.round(performance.now() - groupStartedAt)

  hooks.onNodePatch?.(r3Node!.id, {
    status: "done",
    output: { text: canvasWrapped, metaReview: metaReviewRaw, debate: debateText },
    metadata: { durationMs, personaId: r3PersonaId, canvasInjected: true },
  })
  hooks.onNodeLog?.(r3Node!.id, "Meta-Review 已生成并注入 Scholar Canvas")

  return [
    { id: r1Node!.id, ok: true, summary: "方法论审稿完成", output: { text: r1Out.text } },
    { id: r2Node!.id, ok: true, summary: "创新点审稿完成", output: { text: r2Out.text } },
    {
      id: r3Node!.id,
      ok: true,
      summary: "Area Chair Meta-Review 完成",
      output: { text: canvasWrapped, metaReview: metaReviewRaw },
    },
  ]
}
