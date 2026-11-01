import { beforeEach, describe, expect, it, vi } from "vitest"

const CURRENT_USER = { id: "user-alice" }

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
  resolveUserIdFromRequest: vi.fn(async () => CURRENT_USER.id),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockState.prisma }))

const {
  resetHumanInterventionGatesForTests,
  resolveHumanInterventionSession,
  getPendingIntervention,
  waitForHumanIntervention,
} = await import("@/lib/agent/human-intervention-gate")

const { POST, GET } = await import("@/app/api/agent/intervention/route")

/**
 * 干预门是进程内的全局 Map，键为 sessionId。生产路径上 sessionId 就是 job.id
 * （`agent/jobs/route.ts` 里 `interventionSessionId: job.id`），而 job.id 会出现在
 * 会话列表、日志、URL 里 —— 它不是能力令牌。
 * 因此门必须记住「谁挂起的」，并在唤醒时核对「谁在唤醒」。
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

describe("干预门的归属校验", () => {
  beforeEach(() => {
    resetHumanInterventionGatesForTests()
    mockState.prisma.agentJob.findFirst.mockReset()
    mockState.prisma.agentJob.update.mockReset()
  })

  it("挂起时记录属主；他人唤醒被拒且门仍挂起", async () => {
    const pending = waitForHumanIntervention(
      "job-of-alice",
      "peer-r3",
      "Wait for expert guidance",
      undefined,
      "user-alice"
    )
    // 防未处理 rejection
    pending.catch(() => {})

    const hacked = resolveHumanInterventionSession("job-of-alice", { action: "approve" }, "user-mallory")
    expect(hacked).toEqual({ ok: false, error: "InterventionSessionForbidden" })

    // 门没被消费：属主依然能读到挂起信息
    const stillPending = getPendingIntervention("job-of-alice", "user-alice")
    expect(stillPending?.nodeId).toBe("peer-r3")

    // 他人读不到（不泄露 nodeId / reason）
    expect(getPendingIntervention("job-of-alice", "user-mallory")).toBeNull()

    // 属主可以正常唤醒
    const ok = resolveHumanInterventionSession("job-of-alice", { action: "approve" }, "user-alice")
    expect(ok).toEqual({ ok: true, nodeId: "peer-r3" })
    await expect(pending).resolves.toEqual({ action: "approve" })
  })

  it("未记录属主的门保持旧行为（无用户上下文的服务端内部调用）", async () => {
    const pending = waitForHumanIntervention("anon-sess", "peer-r3", "Wait", undefined)
    const resolved = resolveHumanInterventionSession("anon-sess", { action: "approve" }, "user-anyone")
    expect(resolved.ok).toBe(true)
    await expect(pending).resolves.toEqual({ action: "approve" })
  })

  it("POST 不能靠他人的 sessionId 唤醒（即使同时提交了自己的 jobId）", async () => {
    const pending = waitForHumanIntervention(
      "job-of-bob",
      "peer-r3",
      "Wait",
      undefined,
      "user-bob"
    )
    pending.catch(() => {})

    // alice 提交自己的合法 job（属于 alice）+ bob 的 sessionId
    mockState.prisma.agentJob.findFirst.mockResolvedValueOnce({
      id: "job-of-alice",
      userId: "user-alice",
      checkpoint: {},
    })

    const res = await post({
      sessionId: "job-of-bob",
      nodeId: "peer-r3",
      action: "approve",
      jobId: "job-of-alice",
    })

    // 400 = 先被 sessionId/jobId 一致性检查拦下；403 = 被门归属检查拦下。
    // 两条拒绝路径都成立，安全关键点是 bob 的门不能被消费。
    expect([400, 403]).toContain(res.status)
    // bob 的门必须仍然挂起
    expect(getPendingIntervention("job-of-bob", "user-bob")?.nodeId).toBe("peer-r3")
  })

  it("POST 仅凭 sessionId 也不能唤醒他人的门", async () => {
    const pending = waitForHumanIntervention(
      "job-of-carol",
      "peer-r3",
      "Wait",
      undefined,
      "user-carol"
    )
    pending.catch(() => {})

    const res = await post({ sessionId: "job-of-carol", nodeId: "peer-r3", action: "approve" })
    expect(res.status).toBe(403)
    expect(getPendingIntervention("job-of-carol", "user-carol")?.nodeId).toBe("peer-r3")
  })

  it("GET 不向非属主泄露挂起详情", async () => {
    const pending = waitForHumanIntervention(
      "job-of-dave",
      "peer-r3",
      "Reviewer scores diverge",
      undefined,
      "user-dave"
    )
    pending.catch(() => {})

    const res = await GET(
      new Request("http://localhost/api/agent/intervention?sessionId=job-of-dave", { method: "GET" })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { pending?: boolean; reason?: string; nodeId?: string }
    expect(body.pending).toBe(false)
    expect(body.reason).toBeUndefined()
    expect(body.nodeId).toBeUndefined()
  })

  it("sessionId 与 jobId 不一致时拒绝（防止借自己的 job 走授权、打别人的门）", async () => {
    mockState.prisma.agentJob.findFirst.mockResolvedValueOnce({
      id: "job-of-alice",
      userId: "user-alice",
      checkpoint: {},
    })

    const res = await post({
      sessionId: "some-other-session",
      nodeId: "peer-r3",
      action: "approve",
      jobId: "job-of-alice",
    })
    expect(res.status).toBe(400)
  })
})
