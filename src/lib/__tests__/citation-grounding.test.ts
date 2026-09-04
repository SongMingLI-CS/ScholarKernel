import { describe, expect, it } from "vitest"

import { composeGroundedFinal } from "@/lib/agent/citation-grounding"

describe("composeGroundedFinal", () => {
  it("removes model-generated references and appends only tool-grounded references", () => {
    const modelText = [
      "正文声称检索到了论文 [1]。",
      "",
      "## 参考文献 (References)",
      "[1] Hallucinated Paper. https://example.invalid/fake",
    ].join("\n")
    const grounded = [
      "## 参考文献 (References)",
      "",
      "[1] [Verified Paper](https://arxiv.org/abs/2304.05366)",
    ].join("\n")

    const output = composeGroundedFinal(modelText, grounded)

    expect(output).not.toContain("Hallucinated Paper")
    expect(output).toContain("Verified Paper")
    expect(output.match(/## 参考文献/g)).toHaveLength(1)
  })

  it("does not preserve invented references when no search source was retrieved", () => {
    const output = composeGroundedFinal(
      "基于内部知识回答。\n\n## References\n[1] Invented Citation (2026)",
      ""
    )

    expect(output).toBe("基于内部知识回答。")
  })
})
