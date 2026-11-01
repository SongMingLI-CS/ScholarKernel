import type {
  WorkflowNode,
  WorkflowProvider,
  WorkflowStatus,
  WorkflowTaskType,
} from "@/lib/agent/planner"

/**
 * 工作流拓扑的入参守卫。
 *
 * `workflowNodes` 来自浏览器，服务端会把它写进 `job.checkpoint.nodes`。
 * 该 checkpoint 之后会被 `GET /api/agent/jobs/[id]` 读回并直接用于渲染拓扑、
 * 也被续跑流程当作真实计划使用。所以这里的形状错误不是「一次请求的浪费」，
 * 而是**落库的持久损坏** —— 一个 `[{}]` 就足以让前端拿到 `type: undefined`。
 */

/** 与规划器实际产出的量级对齐：真实计划在 10~20 个节点。上限给出 25 倍余量。 */
export const MAX_WORKFLOW_NODES = 500
/** 指令会同时进入 checkpoint 与续跑 prompt，必须有界。 */
export const MAX_WORKFLOW_INSTRUCTION_CHARS = 4000

const TASK_TYPES: ReadonlySet<string> = new Set<WorkflowTaskType>([
  "read_file",
  "reasoning",
  "audit",
  "research",
  "peer_review",
])
const PROVIDERS: ReadonlySet<string> = new Set<WorkflowProvider>(["local", "cloud"])
const STATUSES: ReadonlySet<string> = new Set<WorkflowStatus>([
  "pending",
  "running",
  "done",
  "error",
  "pending_approval",
])

const MAX_ID_CHARS = 200
const MAX_TITLE_CHARS = 300
const MAX_ERROR_CHARS = 4000
const MAX_LOG_COUNT = 200
const MAX_LOG_CHARS = 4000
const MAX_JSON_DEPTH = 12
const MAX_JSON_ARRAY = 2000

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"])

/**
 * 递归重建 JSON 值：剔除 `__proto__` / `constructor` / `prototype`，
 * 丢弃函数与 symbol，非有限数归一为 null，并限制深度与数组长度。
 * 不使用 `Object.assign` / 展开目标为已有对象，避免把键写到原型链上。
 */
function sanitizeJson(value: unknown, depth = 0): unknown {
  if (value === null) return null
  const t = typeof value
  if (t === "string" || t === "boolean") return value
  if (t === "number") return Number.isFinite(value as number) ? value : null
  if (t === "function" || t === "symbol" || t === "bigint") return null
  if (depth >= MAX_JSON_DEPTH) return null

  if (Array.isArray(value)) {
    return value.slice(0, MAX_JSON_ARRAY).map((item) => sanitizeJson(item, depth + 1))
  }
  if (t === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) continue
      out[key] = sanitizeJson(val, depth + 1)
    }
    return out
  }
  return null
}

function readString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed
}

function normalizeLogs(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const lines: string[] = []
  for (const item of value.slice(0, MAX_LOG_COUNT)) {
    if (typeof item !== "string") continue
    lines.push(item.length > MAX_LOG_CHARS ? item.slice(0, MAX_LOG_CHARS) : item)
  }
  return lines
}

/**
 * 单个节点归一化。返回 `null` 表示**结构不成立**（拒绝整批，而不是悄悄丢弃），
 * 因为静默丢弃会让客户端与服务端对拓扑的认知不一致 —— 那比 400 更难排查。
 */
export function normalizeWorkflowNode(raw: unknown): WorkflowNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>

  const id = readString(rec.id, MAX_ID_CHARS)
  if (!id) return null

  const type = typeof rec.type === "string" ? rec.type : ""
  if (!TASK_TYPES.has(type)) return null

  const provider = typeof rec.provider === "string" ? rec.provider : ""
  if (!PROVIDERS.has(provider)) return null

  const status = typeof rec.status === "string" ? rec.status : ""
  if (!STATUSES.has(status)) return null

  const node: WorkflowNode = {
    id,
    type: type as WorkflowTaskType,
    provider: provider as WorkflowProvider,
    status: status as WorkflowStatus,
  }

  const title = readString(rec.title, MAX_TITLE_CHARS)
  if (title) node.title = title

  const error = readString(rec.error, MAX_ERROR_CHARS)
  if (error) node.error = error

  const logs = normalizeLogs(rec.logs)
  if (logs) node.logs = logs

  if (rec.input !== undefined) node.input = sanitizeJson(rec.input)
  if (rec.output !== undefined) node.output = sanitizeJson(rec.output)
  if (rec.metadata !== undefined) {
    const meta = sanitizeJson(rec.metadata)
    // metadata 必须是对象；数组/标量说明客户端用错了字段，直接拒绝
    if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return null
    node.metadata = meta as Record<string, unknown>
  }

  return node
}

/**
 * 归一化整批节点。
 * - `raw` 不是数组 → `null`（调用方应回退到 checkpoint 或 400）
 * - 任一节点不成立 → `null`（整批拒绝）
 * - 超过 `MAX_WORKFLOW_NODES` → `null`
 * - 成功 → 归一化后的新数组（不与入参共享引用）
 */
export function normalizeWorkflowNodes(raw: unknown): WorkflowNode[] | null {
  if (!Array.isArray(raw)) return null
  if (raw.length > MAX_WORKFLOW_NODES) return null

  const nodes: WorkflowNode[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const node = normalizeWorkflowNode(item)
    if (!node) return null
    // 重复 id 会让 findIndex 只命中第一个，剪枝会插到错误位置
    if (seen.has(node.id)) return null
    seen.add(node.id)
    nodes.push(node)
  }
  return nodes
}

export function isWorkflowInstructionWithinLimit(instruction: string): boolean {
  return instruction.length <= MAX_WORKFLOW_INSTRUCTION_CHARS
}
