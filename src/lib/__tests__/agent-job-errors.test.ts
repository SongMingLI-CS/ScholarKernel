import { describe, expect, it } from "vitest"

import { classifyAgentRunError, serializeAgentJobError, stackPreview } from "@/lib/agent-job-errors"

describe("agent-job-errors", () => {
  it("serializes Error message and first 5 stack lines", () => {
    const err = new Error("JSON parse failed")
    err.stack = "Error: JSON parse failed\n    at plan (/app/planner.ts:10:1)\n    at run (/app/exec.ts:2:1)\n    at line4\n    at line5\n    at line6\n    at line7"
    const out = serializeAgentJobError(err)
    expect(out.errorMessage).toBe("JSON parse failed")
    expect(out.errorStack.split("\n")).toHaveLength(5)
  })

  it("redacts api keys in stack preview", () => {
    const preview = stackPreview("Error\n    Bearer sk-secret1234567890abcdef")
    expect(preview).not.toContain("sk-secret")
    expect(preview).toContain("[redacted]")
  })

  it("classifies cancellation separately from retryable execution failures", () => {
    const aborted = new DOMException("The operation was aborted", "AbortError")
    expect(classifyAgentRunError(aborted)).toMatchObject({
      code: "Aborted",
      cancelled: true,
      retryable: false,
      httpStatus: 499,
    })
    expect(classifyAgentRunError(new Error("WorkflowPlan InvalidJSON"))).toMatchObject({
      code: "PlanFailed",
      cancelled: false,
      retryable: true,
      httpStatus: 502,
    })
  })
})
