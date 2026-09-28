import { describe, expect, it } from "vitest"
import { learningLaunchId, learningDraftFromMessages } from "../learning-studio"
describe("learning launch", () => {
  it("accepts only an explicit learning launch identifier", () => {
    expect(learningLaunchId("?conversation=learning-81520f50-8e6e-40a9-9a5b-e7cb84964914&learning=1")).toBe("learning-81520f50-8e6e-40a9-9a5b-e7cb84964914")
    expect(learningLaunchId("?conversation=other-user&learning=1")).toBeNull()
    expect(learningLaunchId("?conversation=learning-81520f50-8e6e-40a9-9a5b-e7cb84964914")).toBeNull()
  })
  it("reads a bounded draft from import metadata, without using ordinary messages", () => {
    expect(learningDraftFromMessages([{ metadata: { learningStudioDraft: "Explain this passage" } }])).toBe("Explain this passage")
    expect(learningDraftFromMessages([{ content: "ordinary" }, { metadata: { learningStudioDraft: 3 } }])).toBeNull()
    expect(learningDraftFromMessages([{ metadata: { learningStudioDraft: "a".repeat(18001) } }])).toBeNull()
  })
})
