import { describe, expect, it } from "vitest"

import {
  isOnboardingCompleteInStorage,
  onboardingCompleteValue,
  providerPatchForPath,
  readOnboardingCompleteFlag,
} from "@/lib/onboarding"

describe("onboarding", () => {
  it("detects completion flag", () => {
    expect(readOnboardingCompleteFlag(null)).toBe(false)
    expect(isOnboardingCompleteInStorage("done")).toBe(true)
    expect(onboardingCompleteValue()).toBe("done")
  })

  it("maps onboarding path to provider patch", () => {
    expect(providerPatchForPath("ollama")).toEqual({
      providerId: "ollama",
      model: "llama3.2",
      baseUrl: "http://localhost:11434",
    })
    expect(providerPatchForPath("cloud")?.providerId).toBe("deepseek_openai_compat")
    expect(providerPatchForPath("skip")).toBeNull()
  })
})
