import { describe, expect, it } from "vitest"

import { interceptWorkflowPlanInAssistantBubble } from "../agent/planner"

/**
 * 从「可见回复」里剥离计划 JSON 时，原实现取**第一个括号平衡块**。
 *
 * 而本产品自己的输出规范要求用 `[1] [2]` 标注引用，这些编号本身是合法 JSON
 * （数组含一个数字）。于是只要回复正文里出现引用编号：
 * 1. 引用编号会被从用户可见文本里删掉（正文被篡改）；
 * 2. 由它伪造出一个空 reasoning 节点（幽灵计划）；
 * 3. 真正的 ```json 计划块反而原样留在正文里没被剥离。
 */

const PLAN_FENCE =
  '```json\n[{"type":"research","id":"a","input":{"search_query":"GNN survey"}}]\n```'

describe("interceptWorkflowPlanInAssistantBubble 不误吃引用标记", () => {
  it("纯正文里的引用编号不被当作计划", () => {
    const text = "如 [1] 所示，该方向仍有争议。\n\n我们建议进一步验证。"
    expect(interceptWorkflowPlanInAssistantBubble(text)).toBeNull()
  })

  it("引用编号 + 真正计划块时，引用留在正文、计划被剥离", () => {
    const text = `如 [1] 所示，先做检索。\n\n${PLAN_FENCE}`
    const out = interceptWorkflowPlanInAssistantBubble(text)
    expect(out).not.toBeNull()
    // 引用编号必须保留
    expect(out!.cleanedText).toContain("[1]")
    // 计划块必须被剥离干净（连围栏一起）
    expect(out!.cleanedText).not.toContain("search_query")
    expect(out!.cleanedText).not.toContain("```")
    // 计划内容正确
    expect(out!.planned).toHaveLength(1)
    expect(out!.planned[0]!.id).toBe("a")
    expect(out!.planned[0]!.type).toBe("research")
  })

  it("多个引用编号时同样以真计划为准", () => {
    const text = `据 [1] 与 [2] 的结论：\n${PLAN_FENCE}`
    const out = interceptWorkflowPlanInAssistantBubble(text)
    expect(out!.planned).toHaveLength(1)
    expect(out!.cleanedText).toContain("[1]")
    expect(out!.cleanedText).toContain("[2]")
  })

  it("裸计划数组（无围栏）仍能被剥离", () => {
    const text = '先说明一句 [1]。\n[{"type":"reasoning","id":"b"}]'
    const out = interceptWorkflowPlanInAssistantBubble(text)
    expect(out!.planned.map((n) => n.id)).toEqual(["b"])
    expect(out!.cleanedText).toContain("[1]")
    expect(out!.cleanedText).not.toContain('"reasoning"')
  })

  it("只有普通数据数组时不拦截", () => {
    expect(interceptWorkflowPlanInAssistantBubble("统计结果 [1, 2, 3]。")).toBeNull()
  })
})
