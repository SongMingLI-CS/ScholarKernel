import { beforeEach, describe, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({ job: vi.fn(), decision: vi.fn(), create: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: {
  agentJob: { findFirst: mocks.job },
  agentIntervention: { findUnique: mocks.decision, create: mocks.create },
} }))
import { applyOwnedIntervention } from "@/lib/agent/intervention-service"
import { resetHumanInterventionGatesForTests, waitForHumanIntervention } from "@/lib/agent/human-intervention-gate"

describe("normal persisted Job intervention", () => {
  beforeEach(() => { vi.clearAllMocks(); resetHumanInterventionGatesForTests() })
  it("saves an approved decision before waking the matching waiting task", async () => {
    mocks.job.mockResolvedValue({ id: "job-1", status: "running", checkpoint: { humanInterventionPending: { nodeId: "peer-r3", sessionId: "job-1" } } })
    mocks.decision.mockResolvedValue(null)
    mocks.create.mockResolvedValue({ id: "decision-1", action: "approve", instruction: null })
    const pending = waitForHumanIntervention("job-1", "peer-r3", "Review", undefined, { userId: "user-1", jobId: "job-1" })
    await expect(applyOwnedIntervention("user-1", "job-1", "peer-r3", { action: "approve" })).resolves.toMatchObject({ ok: true })
    await expect(pending).resolves.toEqual({ action: "approve" })
    expect(mocks.create).toHaveBeenCalledWith({ data: { jobId: "job-1", userId: "user-1", nodeId: "peer-r3", action: "approve", instruction: null } })
  })
  it("acknowledges a repeated identical decision without applying it again", async () => {
    mocks.job.mockResolvedValue({ id: "job-1", status: "done" })
    mocks.decision.mockResolvedValue({ action: "approve", instruction: null })
    await expect(applyOwnedIntervention("user-1", "job-1", "peer-r3", { action: "approve" })).resolves.toMatchObject({ ok: true, duplicate: true })
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
