import { bench, describe } from "vitest"

import { parsePlan } from "@/lib/agent/planner"
import { sanitizeExportHtml } from "@/lib/export-utils"

/**
 * 本轮新增的两条热路径：
 * - `parsePlan` 从「一次贪婪正则」改成「括号平衡扫描 + 结构打分」，复杂度声称为 O(n)，
 *   需要确认候选块数量增长时不会退化成二次扫描。
 * - `sanitizeExportHtml` 每次导出对每条消息各跑一遍，且新增了 URL 属性重写与实体解码，
 *   需要确认正则链在数十 KB 的正文上仍是线性。

 */

function buildPlanText(citationMarkers: number, taskCount: number): string {
  const prose = Array.from({ length: citationMarkers }, (_, i) => `第 ${i + 1} 点见 [${i + 1}]。`).join("")
  const tasks = Array.from({ length: taskCount }, (_, i) =>
    JSON.stringify({
      type: i % 3 === 0 ? "research" : i % 3 === 1 ? "read_file" : "reasoning",
      id: `task-${i}`,
      title: `任务 ${i}`,
      input: i % 3 === 0 ? { search_query: `query ${i}` } : { path: `src/lib/m${i}.ts` },
    })
  ).join(",")
  return `${prose}\n\n已完成规划：\n[${tasks}]`
}

function buildExportHtml(paragraphs: number): string {
  const body = Array.from({ length: paragraphs }, (_, i) => {
    return (
      `<p>第 ${i} 段：如图 <img src="/a.png" alt="x"> 所示，` +
      `参见 <a href="https://example.com/p/${i}">文献 ${i}</a>，` +
      `另见 <a href="/docs/${i}">附录</a>。</p>`
    )
  }).join("\n")
  return `<article>${body}</article>`
}

const PLAN_SMALL = buildPlanText(0, 8)
const PLAN_MANY_MARKERS = buildPlanText(200, 8)
const PLAN_MANY_TASKS = buildPlanText(200, 60)

const HTML_SMALL = buildExportHtml(50) // ≈ 6 KB
const HTML_LARGE = buildExportHtml(800) // ≈ 100 KB

describe("plan extraction", () => {
  bench("parsePlan / 8 tasks, no citation markers", () => {
    parsePlan(PLAN_SMALL)
  })

  bench("parsePlan / 8 tasks + 200 citation markers", () => {
    parsePlan(PLAN_MANY_MARKERS)
  })

  bench("parsePlan / 60 tasks + 200 citation markers", () => {
    parsePlan(PLAN_MANY_TASKS)
  })
})

describe("export sanitize", () => {
  bench("sanitizeExportHtml / ~6KB html", () => {
    sanitizeExportHtml(HTML_SMALL)
  })

  bench("sanitizeExportHtml / ~100KB html", () => {
    sanitizeExportHtml(HTML_LARGE)
  })
})
