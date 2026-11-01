import { describe, expect, it } from "vitest"

import { parseAndValidateTaskList, parsePlan } from "../agent/planner"

/**
 * 规划文本里几乎总有引用标记。
 *
 * `parsePlan` 原实现用贪婪正则 `/\[[\s\S]*\]/` 取「第一个 [ 到最后一个 ]」，
 * 正文里只要出现 `[1]` 这类引用编号（本产品的输出规范就要求这样标注），
 * 这段贪婪匹配必然跨越正文与 JSON，`JSON.parse` 失败后退到
 * `/\{[\s\S]*\}/`，于是抓到的是**单个任务对象**而非任务数组；
 * 若引用标记成对出现（`[1]` 与 `[23]`），甚至直接返回 `[1]`。
 *
 * 后果不是「解析报错」，而是**静默降级**：`extractRawJsonTasks` 拿不到任务数组，
 * `forceAssembleTasksFromRaw([])` 兜底注入「知识图谱直接回答」节点 ——
 * 一次文献综述请求就此变成不带任何检索的直接作答。
 */

const TASKS = '[{"type":"research","id":"a","input":{"search_query":"GNN survey"}},{"type":"reasoning","id":"b"}]'

describe("parsePlan 不被引用标记劫持", () => {
  it("正文含单个引用编号时仍取出任务数组", () => {
    const out = parsePlan(`参考文献 [1] 表明需要检索。\n${TASKS}`)
    expect(Array.isArray(out)).toBe(true)
    expect((out as unknown[]).length).toBe(2)
  })

  it("正文含多个引用编号时不退化成 [1]", () => {
    const out = parsePlan(`如 [1] 与 [23] 所述：\n${TASKS}`)
    expect(Array.isArray(out)).toBe(true)
    expect((out as unknown[]).length).toBe(2)
    expect((out as Array<{ id: string }>).map((t) => t.id)).toEqual(["a", "b"])
  })

  it("代码围栏 + 引用前缀同样成立", () => {
    const out = parsePlan(`参考文献 [1]。\n\`\`\`json\n${TASKS}\n\`\`\``)
    expect((out as unknown[]).length).toBe(2)
  })

  it("干净数组不受影响", () => {
    expect((parsePlan(TASKS) as unknown[]).length).toBe(2)
  })

  it("任务数组被包在对象里时取对象", () => {
    const out = parsePlan('前言 [1]。\n{"tasks":[{"type":"research","id":"a"}]}')
    expect(Array.isArray(out)).toBe(false)
    expect((out as { tasks: unknown[] }).tasks.length).toBe(1)
  })

  it("字符串内部的方括号不干扰括号平衡", () => {
    const out = parsePlan('[{"type":"reasoning","id":"a","title":"见 [2] 与 ] 号"}]')
    expect((out as unknown[]).length).toBe(1)
    expect((out as Array<{ title: string }>)[0]!.title).toBe("见 [2] 与 ] 号")
  })

  it("完全没有 JSON 时抛错而不是返回垃圾", () => {
    expect(() => parsePlan("这里没有任何结构化内容")).toThrow()
  })
})

describe("parseAndValidateTaskList 端到端", () => {
  it("引用标记不会让检索节点消失", () => {
    const list = parseAndValidateTaskList(`参考文献 [1] 与 [2]。\n${TASKS}`)
    expect(list.map((t) => t.id)).toEqual(["a", "b"])
    expect(list[0]!.type).toBe("research")
  })

  it("干净输入的结果与含引用标记的输入一致", () => {
    const clean = parseAndValidateTaskList(TASKS).map((t) => t.id)
    const dirty = parseAndValidateTaskList(`参考 [1]。\n${TASKS}`).map((t) => t.id)
    expect(dirty).toEqual(clean)
  })
})
