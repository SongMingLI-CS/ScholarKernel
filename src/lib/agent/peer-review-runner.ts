import { streamText } from "ai"
import {
  AREA_CHAIR_PERSONA,
  buildPeerReviewCanvasOutput,
  getPersonaById,
  INNOVATION_SCOUT_PERSONA,
  METHODOLOGY_CRITIC_PERSONA,
  type PeerReviewPersonaId,
} from "@/lib/agent/agent-personas"
import type {
  AgentExecutorDeps,
  AgentExecutorHooks,
  HumanInterventionDecision,
  NodeProgressPayload,
  PeerReviewStreamProgress,
  SubtaskResult,
} from "@/lib/agent/executor-types"
import { waitForHumanIntervention } from "@/lib/agent/human-intervention-gate"
import { pruneWorkflowAfterHumanIntervention } from "@/lib/agent/human-intervention-pruning"
import { shouldTriggerPeerReviewBreakpoint, hasPeerReviewScoreGap } from "@/lib/agent/peer-review-score-gap"
import { formatAcademicChunksForContext, semanticChunkAcademicText } from "@/lib/document/academic-semantic-chunker"
import {
  isStageComplete,
  mergePeerReviewCheckpoint,
  type PeerReviewCheckpointData,
} from "@/lib/agent/peer-review-checkpoint"
import {
  buildGenModelForCloudInference,
  consumeStreamTextOutput,
  llmCallSettings,
  logLlmCallFailure,
  normalizeModelId,
  providerSelfIntro,
  type StreamTextCallExtras,
} from "@/lib/agent/llm-utils"
import { recordLlmUsageAsync } from "@/lib/billing/token-usage-bridge"
import type { WorkflowNode } from "@/lib/agent/planner"

export type PeerReviewGenerateFn = (input: {
  personaId: PeerReviewPersonaId
  systemPrompt: string
  userPrompt: string
  onProgress?: (payload: PeerReviewStreamProgress) => void
}) => Promise<string>

export type PeerReviewGenerateStreamFn = (input: {
  personaId: PeerReviewPersonaId
  systemPrompt: string
  userPrompt: string
  onProgress?: (payload: PeerReviewStreamProgress) => void
}) => Promise<string>

export type PeerReviewDebateFn = (input: {
  methodologyReview: string
  innovationReview: string
}) => Promise<string>

export type ExecutePeerReviewGroupInput = {
  groupNodes: WorkflowNode[]
  userInput: string
  deps: AgentExecutorDeps
  hooks: Pick<
    AgentExecutorHooks,
    "onNodePatch" | "onNodeLog" | "onProgress" | "onInterventionPending" | "onWorkflowTopologyPruned"
  >
  generateReview?: PeerReviewGenerateFn
  generateReviewStream?: PeerReviewGenerateStreamFn
  generateDebate?: PeerReviewDebateFn
  checkpoint?: PeerReviewCheckpointData | null
  onCheckpoint?: (patch: Partial<PeerReviewCheckpointData> & { markComplete?: PeerReviewCheckpointData["completedStages"][number] }) => void | Promise<void>
  /** 全工作流节点（供剪枝写入）；缺省时仅更新 group 内 metadata */
  allWorkflowNodes?: WorkflowNode[]
  waitForHumanIntervention?: typeof waitForHumanIntervention
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

/** 对长文本注入语义切片 RAG 上下文，供审稿智能体精准引用公式与章节。 */
export function enrichPeerReviewSubject(subject: string): string {
  const trimmed = subject.trim()
  if (trimmed.length < 1200) return trimmed

  const chunks = semanticChunkAcademicText({ text: trimmed })
  if (chunks.length <= 1) return trimmed

  const rag = formatAcademicChunksForContext(chunks)
  return [trimmed, "", rag].join("\n")
}

function personaIdFromNode(node: WorkflowNode, fallback: PeerReviewPersonaId): PeerReviewPersonaId {
  const meta = node.metadata?.personaId
  if (typeof meta === "string" && getPersonaById(meta)) return meta as PeerReviewPersonaId
  return fallback
}

function emitProgress(
  hooks: ExecutePeerReviewGroupInput["hooks"],
  payload: NodeProgressPayload
) {
  hooks.onProgress?.(payload)
}

function streamDraftPatch(streamId: string, text: string): Partial<WorkflowNode> {
  return {
    metadata: {
      streamDrafts: { [streamId]: text },
      activeStreamId: streamId,
    },
  }
}

async function defaultGenerateReviewStream(
  deps: AgentExecutorDeps,
  node: WorkflowNode,
  personaId: PeerReviewPersonaId,
  systemPrompt: string,
  userPrompt: string,
  onProgress?: (payload: PeerReviewStreamProgress) => void
): Promise<string> {
  const persona = getPersonaById(personaId)
  if (!persona) throw new Error(`UnknownPersona:${personaId}`)

  const active = deps.activeProvider
  const runtimeKeys = deps.getRuntimeKeys?.() ?? deps.runtimeKeys
  const model = buildGenModelForCloudInference(active, runtimeKeys, node)
  const modelUsed = normalizeModelId(active.providerId, active.model)

  const streamed = streamText({
    model,
    system: [providerSelfIntro(active), "", systemPrompt].join("\n"),
    prompt: userPrompt,
    temperature: deps.inference?.temperature ?? 0.35,
    ...llmCallSettings(deps.signal),
  })

  let prevLen = 0
  const text = await consumeStreamTextOutput(
    streamed,
    (acc) => {
      const delta = acc.length > prevLen ? acc.slice(prevLen) : ""
      prevLen = acc.length
      onProgress?.({ streamId: personaId, text: acc, delta: delta || undefined })
    },
    deps.signal,
    {
      onStreamComplete: ({ ttftMs }) => {
        void streamed.usage.then((usage) => {
          recordLlmUsageAsync(deps, modelUsed, usage, ttftMs)
        })
      },
    }
  )

  return text.trim()
}

async function defaultGenerateReview(
  deps: AgentExecutorDeps,
  node: WorkflowNode,
  personaId: PeerReviewPersonaId,
  systemPrompt: string,
  userPrompt: string,
  onProgress?: (payload: PeerReviewStreamProgress) => void
): Promise<string> {
  return defaultGenerateReviewStream(deps, node, personaId, systemPrompt, userPrompt, onProgress)
}

async function persistStageCheckpoint(
  input: ExecutePeerReviewGroupInput,
  state: PeerReviewCheckpointData,
  patch: Partial<PeerReviewCheckpointData> & { markComplete?: PeerReviewCheckpointData["completedStages"][number] }
) {
  const merged = mergePeerReviewCheckpoint(state, patch)
  Object.assign(state, merged)
  await input.onCheckpoint?.(patch)
}

async function runSingleReviewer(
  node: WorkflowNode,
  personaId: PeerReviewPersonaId,
  subject: string,
  deps: AgentExecutorDeps,
  hooks: ExecutePeerReviewGroupInput["hooks"],
  generateStream: PeerReviewGenerateStreamFn,
  nodeStartedAt: number,
  cachedText?: string
): Promise<{ node: WorkflowNode; text: string; skipped: boolean }> {
  const persona = getPersonaById(personaId) ?? METHODOLOGY_CRITIC_PERSONA

  if (cachedText?.trim()) {
    hooks.onNodePatch?.(node.id, {
      status: "done",
      output: { text: cachedText, personaId, resumed: true },
      metadata: {
        durationMs: 0,
        personaId,
        streamDrafts: { [personaId]: cachedText },
        resumedFromCheckpoint: true,
      },
    })
    emitProgress(hooks, {
      nodeId: node.id,
      streamId: personaId,
      kind: "stream_complete",
      text: cachedText,
    })
    hooks.onNodeLog?.(node.id, `${persona.label} 从快照恢复（跳过 LLM）`)
    return { node, text: cachedText, skipped: true }
  }

  hooks.onNodePatch?.(node.id, { status: "running" })
  emitProgress(hooks, {
    nodeId: node.id,
    streamId: personaId,
    kind: "status_line",
    line: `${persona.label} 开始独立评审…`,
  })
  hooks.onNodeLog?.(node.id, `${persona.label} 开始独立评审…`)

  const userPrompt = [
    "请对以下投稿内容（摘要 / 实验设计 / 方法描述）进行严格审稿：",
    "",
    "--- SUBMISSION ---",
    subject,
    "--- END ---",
  ].join("\n")

  try {
    const text = await generateStream({
      personaId,
      systemPrompt: persona.systemPrompt,
      userPrompt,
      onProgress: (p) => {
        emitProgress(hooks, {
          nodeId: node.id,
          streamId: p.streamId,
          kind: "stream_delta",
          text: p.text,
          delta: p.delta,
        })
        hooks.onNodePatch?.(node.id, streamDraftPatch(p.streamId, p.text))
      },
    })

    emitProgress(hooks, {
      nodeId: node.id,
      streamId: personaId,
      kind: "stream_complete",
      text,
    })

    hooks.onNodeLog?.(node.id, `${persona.label} 评审完成（${text.length} chars）`)
    hooks.onNodePatch?.(node.id, {
      status: "done",
      output: { text, personaId },
      metadata: {
        durationMs: Math.round(performance.now() - nodeStartedAt),
        personaId,
        streamDrafts: { [personaId]: text },
      },
    })
    return { node, text, skipped: false }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logLlmCallFailure(`peer-review: ${node.id}`, e)
    hooks.onNodePatch?.(node.id, { status: "error", error: msg })
    throw e
  }
}

export async function executePeerReviewGroup(input: ExecutePeerReviewGroupInput): Promise<SubtaskResult[]> {
  const { groupNodes, userInput, deps, hooks } = input

  const generateStream =
    input.generateReviewStream ??
    input.generateReview ??
    ((args) =>
      defaultGenerateReviewStream(deps, groupNodes[0]!, args.personaId, args.systemPrompt, args.userPrompt, args.onProgress))

  const generateReview =
    input.generateReview ??
    ((args) => defaultGenerateReview(deps, groupNodes[2] ?? groupNodes[0]!, args.personaId, args.systemPrompt, args.userPrompt))

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
  const subject = enrichPeerReviewSubject(resolveSubjectText(userInput, groupNodes))
  const groupStartedAt = performance.now()

  const cpState = mergePeerReviewCheckpoint(input.checkpoint ?? null, { subject })

  hooks.onNodeLog?.(r1Node!.id, "【Peer Review】并行启动 Reviewer #1 & #2…")
  hooks.onNodeLog?.(r2Node!.id, "【Peer Review】并行启动 Reviewer #1 & #2…")

  const r1PersonaId = personaIdFromNode(r1Node!, "methodology_critic")
  const r2PersonaId = personaIdFromNode(r2Node!, "innovation_scout")

  const r1Cached = isStageComplete(cpState, "r1") ? cpState.methodologyReview : undefined
  const r2Cached = isStageComplete(cpState, "r2") ? cpState.innovationReview : undefined

  if (!r1Cached || !r2Cached) {
    hooks.onNodePatch?.(r1Node!.id, { status: r1Cached ? "done" : "running" })
    hooks.onNodePatch?.(r2Node!.id, { status: r2Cached ? "done" : "running" })
  }

  const [r1Out, r2Out] = await Promise.all([
    runSingleReviewer(r1Node!, r1PersonaId, subject, deps, hooks, generateStream, groupStartedAt, r1Cached),
    runSingleReviewer(r2Node!, r2PersonaId, subject, deps, hooks, generateStream, groupStartedAt, r2Cached),
  ])

  if (!r1Out.skipped) {
    await persistStageCheckpoint(input, cpState, {
      methodologyReview: r1Out.text,
      markComplete: "r1",
    })
  }
  if (!r2Out.skipped) {
    await persistStageCheckpoint(input, cpState, {
      innovationReview: r2Out.text,
      markComplete: "r2",
    })
  }

  hooks.onNodeLog?.(r1Node!.id, "【Debate Stream】Reviewer #1 批判意见已提交，进入激辩…")
  hooks.onNodeLog?.(r2Node!.id, "【Debate Stream】等待 Reviewer #2 回应…")

  let humanInstruction: string | undefined
  let skipDebateFromIntervention = false

  const sessionId = deps.interventionSessionId?.trim()
  const needsBreakpoint = shouldTriggerPeerReviewBreakpoint(r1Out.text, r2Out.text)

  if (needsBreakpoint && sessionId && r3Node) {
    const reason = hasPeerReviewScoreGap(r1Out.text, r2Out.text)
      ? "Reviewer scores diverge — wait for expert guidance"
      : "Wait for expert guidance"

    hooks.onNodePatch?.(r3Node.id, {
      status: "pending_approval",
      metadata: { interventionReason: reason, personaId: "area_chair" },
    })
    hooks.onInterventionPending?.({
      nodeId: r3Node.id,
      status: "pending_approval",
      reason,
      sessionId,
    })
    hooks.onNodeLog?.(r3Node.id, `【Human-in-the-Loop】断点挂起：${reason}`)

    const waitFn = input.waitForHumanIntervention ?? waitForHumanIntervention
    let decision: HumanInterventionDecision
    try {
      decision = await waitFn(sessionId, r3Node.id, reason, deps.signal)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      hooks.onNodePatch?.(r3Node.id, { status: "error", error: msg })
      throw e
    }

    if (decision.action === "redirect" && decision.instruction.trim()) {
      humanInstruction = decision.instruction.trim()
      const baseNodes = decision.prunedNodes ?? input.allWorkflowNodes ?? groupNodes
      const pruned = pruneWorkflowAfterHumanIntervention({
        nodes: baseNodes,
        breakpointNodeId: r3Node.id,
        instruction: humanInstruction,
      })
      skipDebateFromIntervention = pruned.skippedDebate
      hooks.onWorkflowTopologyPruned?.(pruned.nodes)
      hooks.onNodeLog?.(r3Node.id, `【Human-in-the-Loop】思考树已剪枝，插入节点 ${pruned.insertedNodeId}`)
    }

    hooks.onNodePatch?.(r3Node.id, { status: "running" })
  }

  let debateText = isStageComplete(cpState, "debate") ? cpState.debate ?? "" : ""

  if (skipDebateFromIntervention) {
    debateText = humanInstruction
      ? `[Human Expert Override — debate skipped]\n${humanInstruction}`
      : "[Human Expert Override — debate skipped]"
    hooks.onNodeLog?.(r1Node!.id, "【Debate Stream】已按专家指令跳过激辩环节")
    hooks.onNodeLog?.(r2Node!.id, "【Debate Stream】已按专家指令跳过激辩环节")
  } else if (!debateText.trim()) {
    debateText = await generateDebate({
      methodologyReview: r1Out.text,
      innovationReview: r2Out.text,
    })

    const debateLines = debateText.split("\n").filter(Boolean)
    for (const line of debateLines.slice(0, 24)) {
      emitProgress(hooks, {
        nodeId: r2Node!.id,
        streamId: "debate",
        kind: "status_line",
        line: `[Debate] ${line}`,
      })
      hooks.onNodeLog?.(r1Node!.id, `[Debate] ${line}`)
      hooks.onNodeLog?.(r2Node!.id, `[Debate] ${line}`)
    }

    await persistStageCheckpoint(input, cpState, {
      debate: debateText,
      markComplete: "debate",
    })
  } else if (!skipDebateFromIntervention) {
    hooks.onNodeLog?.(r1Node!.id, "【Debate Stream】从快照恢复激辩记录")
    hooks.onNodeLog?.(r2Node!.id, "【Debate Stream】从快照恢复激辩记录")
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
    humanInstruction
      ? ["【人类专家干预指令 — 必须优先遵循】", humanInstruction, ""].join("\n")
      : "",
    "请按顶会 Area Chair 标准输出最终 meta-review（Markdown）。",
  ]
    .filter(Boolean)
    .join("\n")

  let metaReviewRaw = cpState.metaReview?.trim() ? cpState.metaReview : ""

  if (!metaReviewRaw.trim()) {
    try {
      metaReviewRaw = await generateReview({
        personaId: "area_chair",
        systemPrompt: chairPersona.systemPrompt,
        userPrompt: metaPrompt,
        onProgress: (p) => {
          emitProgress(hooks, {
            nodeId: r3Node!.id,
            streamId: "area_chair",
            kind: "stream_delta",
            text: p.text,
            delta: p.delta,
          })
          hooks.onNodePatch?.(r3Node!.id, streamDraftPatch("area_chair", p.text))
        },
      })
      await persistStageCheckpoint(input, cpState, { metaReview: metaReviewRaw, markComplete: "r3" })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logLlmCallFailure(`peer-review: ${r3Node!.id}`, e)
      hooks.onNodePatch?.(r3Node!.id, { status: "error", error: msg })
      throw e
    }
  } else {
    hooks.onNodeLog?.(r3Node!.id, "Meta-Review 从快照恢复")
  }

  const canvasWrapped = buildPeerReviewCanvasOutput(metaReviewRaw)
  const durationMs = Math.round(performance.now() - groupStartedAt)

  hooks.onNodePatch?.(r3Node!.id, {
    status: "done",
    output: { text: canvasWrapped, metaReview: metaReviewRaw, debate: debateText },
    metadata: { durationMs, personaId: r3PersonaId, canvasInjected: true, streamDrafts: { area_chair: metaReviewRaw } },
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
