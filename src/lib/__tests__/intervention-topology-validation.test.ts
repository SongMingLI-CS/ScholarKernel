import { beforeEach, describe, expect, it, vi } from "vitest"

const mockState = vi.hoisted(() => ({
  prisma: {
    agentJob: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/auth-user", () => ({
  resolveUserIdFromRequest: vi.fn(async () => "user-alice"),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockState.prisma }))

const { resetHumanInterventionGatesForTests, waitForHumanIntervention } = await import(
  "@/lib/agent/human-intervention-gate"
)
const { POST } = await import("@/app/api/agent/intervention/route")
const { buildPeerReviewWorkflowNodes } = await import("@/lib/agent/planner")

/**
 * `workflowNodes` 是客户端字段，服务端把它原样写进 `job.checkpoint.nodes`。
 * 这个 checkpoint 会被下一次 GET /api/agent/jobs/[id] 读回来渲染拓扑，
 * 所以形状错误不是「一次请求的浪费」，而是**落库的持久损坏**。
 */

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/agent/intervention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  )
}

const LEGIT = buildPeerReviewWorkflowNodes()

function redirectBody(overrides: Record<string, unknown>) {
  return {
    sessionId: "job-1",
    jobId: "job-1",
    nodeId: LEGIT[0]!.id,
    action: "redirect",
    instruction: "重点重写第三章",
    workflowNodes: LEGIT,
    ...overrides,
  }
}

describe("干预路由的拓扑入参校验", () => {
  beforeEach(() => {
    resetHumanInterventionGatesForTests()
    mockState.prisma.agentJob.findFirst.mockReset()
    mockState.prisma.agentJob.update.mockReset()
    mockState.prisma.agentJob.update.mockResolvedValue({})
    mockState.prisma.agentJob.findFirst.mockResolvedValue({
      id: "job-1",
      userId: "user-alice",
      checkpoint: { nodes: LEGIT },
    })
    void waitForHumanIntervention("job-1", LEGIT[0]!.id, "Wait", undefined, "user-alice").catch(() => {})
  })

  it("空对象节点被拒（缺 id/type/provider/status）", async () => {
    const res = await post(redirectBody({ workflowNodes: [{}] }))
    expect(res.status).toBe(400)
    expect(mockState.prisma.agentJob.update).not.toHaveBeenCalled()
  })

  it("非法枚举值被拒", async () => {
    const bad = [{ ...LEGIT[0], type: "definitely_not_a_task_type" }]
    const res = await post(redirectBody({ workflowNodes: bad }))
    expect(res.status).toBe(400)
  })

  it("节点数超上限被拒", async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ ...LEGIT[0], id: `n-${i}` }))
    const res = await post(redirectBody({ workflowNodes: many }))
    expect(res.status).toBe(400)
  })

  it("redirect 指令超长被拒（指令会进 prompt 与 checkpoint）", async () => {
    const res = await post(redirectBody({ instruction: "改".repeat(4001) }))
    expect(res.status).toBe(400)
  })

  it("workflowNodes 不是数组被拒（不静默回退到 checkpoint）", async () => {
    const res = await post(redirectBody({ workflowNodes: "not-an-array" }))
    expect(res.status).toBe(400)
  })

  it("重复节点 id 被拒（findIndex 只命中第一个，剪枝会插错位置）", async () => {
    const dup = [LEGIT[0], { ...LEGIT[1], id: LEGIT[0]!.id }]
    const res = await post(redirectBody({ workflowNodes: dup }))
    expect(res.status).toBe(400)
  })

  it("合法拓扑照常通过，且落库的是归一化后的节点", async () => {
    const res = await post(redirectBody({}))
    expect(res.status).toBe(200)
    const payload = mockState.prisma.agentJob.update.mock.calls[0]?.[0] as
      | { data?: { checkpoint?: { nodes?: unknown[] } } }
      | undefined
    const persisted = payload?.data?.checkpoint?.nodes ?? []
    expect(persisted.length).toBe(LEGIT.length + 1)
    expect(persisted.every((n) => typeof (n as { id?: unknown }).id === "string")).toBe(true)
  })

  it("归一化不透传 __proto__ 键（下游任何 Object.assign 都不会改写原型）", async () => {
    // JSON.parse 会创建**自有**的 __proto__ 数据属性；对象字面量里的 __proto__
    // 只是设置原型，构造不出这个载荷。
    const polluted = JSON.parse(
      '{"id":"proto-node","type":"reasoning","provider":"cloud","status":"pending","__proto__":{"polluted":"yes"},"metadata":{}}'
    )
    expect(Object.prototype.hasOwnProperty.call(polluted, "__proto__")).toBe(true)

    const res = await post(redirectBody({ workflowNodes: [polluted] }))
    expect(res.status).toBe(200)

    const payload = mockState.prisma.agentJob.update.mock.calls[0]?.[0] as
      | { data?: { checkpoint?: { nodes?: unknown[] } } }
      | undefined
    const first = (payload?.data?.checkpoint?.nodes ?? [])[0] as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(first, "__proto__")).toBe(false)
    // 下游拿到这个节点做 Object.assign 时，目标对象原型不能被改写
    const clone = Object.assign({}, first)
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype)
  })
})
