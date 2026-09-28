import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({ prisma: {} }))

import { mergeRuntimeKeysForServer } from "@/lib/agent-server-run"

describe("agent-server-run", () => {
  it("mergeRuntimeKeysForServer prefers explicit keys over env", () => {
    const merged = mergeRuntimeKeysForServer(
      { deepseek: "from-body" },
      { deepseek: "from-env", openai: "o-env" }
    )
    expect(merged.deepseek).toBe("from-body")
    expect(merged.openai).toBe("o-env")
  })
})
