import { describe, expect, it } from "vitest"

import {
  buildDualSearchQueries,
  expandSearchQueries,
  extractResearchTopic,
  formatResearchHitLines,
  isBroadTopicQuery,
  isSurveyOrProgressTopic,
  mergeAcademicSearchHits,
  mergeAcademicSearchResponses,
  RERANK_FINAL_TOP_K,
  resolveResearchQueryList,
  RETRIEVAL_RECALL_TOP_K,
  serializeResearchOutputForReasoning,
} from "@/lib/tools/academic-search-strategy"
import type { AcademicSearchHit, AcademicSearchResponse } from "@/lib/tools/search-tool"

describe("academic-search-strategy", () => {
  it("exports two-stage retrieval constants", () => {
    expect(RETRIEVAL_RECALL_TOP_K).toBeGreaterThanOrEqual(25)
    expect(RETRIEVAL_RECALL_TOP_K).toBeLessThanOrEqual(30)
    expect(RERANK_FINAL_TOP_K).toBe(5)
  })

  it("detects broad LLM topics", () => {
    expect(isBroadTopicQuery("LLM", "大语言模型最新进展")).toBe(true)
    expect(isBroadTopicQuery("SELF: Simple Efficient Language Model full paper arxiv", "")).toBe(false)
  })

  it("detects survey/progress intents", () => {
    expect(isSurveyOrProgressTopic("帮我写一份 LLM 综述")).toBe(true)
    expect(isSurveyOrProgressTopic("read src/app/page.tsx")).toBe(false)
  })

  it("expands broad topics into diversified English queries", () => {
    const qs = expandSearchQueries("LLM 进展", "LLM")
    expect(qs).toHaveLength(3)
    expect(qs[0]).toMatch(/survey/i)
    expect(qs[1]).toMatch(/State-of-the-art/i)
    expect(qs[2]).toMatch(/Core/i)
  })

  it("builds dual survey + methodology queries", () => {
    const [a, b] = buildDualSearchQueries("计算机视觉核心进展", "computer vision")
    expect(a).toMatch(/survey/i)
    expect(b).toMatch(/methodology|state-of-the-art/i)
  })

  it("merges hits by URL without dropping titles", () => {
    const a: AcademicSearchHit = { source_id: "1", title: "Paper A", url: "https://a.org/1" }
    const b: AcademicSearchHit = { source_id: "1", title: "Paper A dup", url: "https://a.org/1" }
    const c: AcademicSearchHit = { source_id: "2", title: "Paper B", url: "https://b.org/2" }
    const merged = mergeAcademicSearchHits([], [a, b, c])
    expect(merged).toHaveLength(2)
    expect(merged.map((x) => x.title)).toEqual(["Paper A", "Paper B"])
    expect(merged[0]?.source_id).toBe("1")
    expect(merged[1]?.source_id).toBe("2")
  })

  it("formatResearchHitLines keeps every URL", () => {
    const hits: AcademicSearchHit[] = Array.from({ length: 10 }, (_, i) => ({
      source_id: String(i + 1),
      title: `T${i}`,
      url: `https://ex.test/${i}`,
      snippet: "x".repeat(800),
    }))
    const lines = formatResearchHitLines(hits, 100)
    expect(lines).toHaveLength(10)
    for (let i = 0; i < 10; i++) {
      expect(lines[i]).toContain(`https://ex.test/${i}`)
      expect(lines[i]).toContain("…")
    }
  })

  it("serializeResearchOutputForReasoning retains all references", () => {
    const output = {
      provider: "tavily",
      query: "q",
      total: 2,
      results: [
        { source_id: "1", title: "A", url: "https://a", snippet: "long ".repeat(120) },
        { source_id: "2", title: "B", url: "https://b" },
      ],
    }
    const ser = serializeResearchOutputForReasoning(output)
    expect(ser.references).toHaveLength(2)
    expect(ser.references[0]?.url).toBe("https://a")
    expect(ser.references[0]?.snippet_preview?.endsWith("…")).toBe(true)
  })

  it("resolveResearchQueryList prefers planner search_queries", () => {
    const qs = resolveResearchQueryList(
      { search_queries: ["q-a", "q-b"] },
      "LLM",
      "大模型"
    )
    expect(qs).toEqual(["q-a", "q-b"])
  })

  it("mergeAcademicSearchResponses aggregates parallel batches", () => {
    const r1: AcademicSearchResponse = {
      provider: "tavily",
      query: "q1",
      academicOnly: true,
      total: 1,
      status: "ok",
      results: [{ source_id: "1", title: "A", url: "https://a" }],
    }
    const r2: AcademicSearchResponse = {
      provider: "tavily",
      query: "q2",
      academicOnly: true,
      total: 1,
      status: "ok",
      results: [{ source_id: "1", title: "B", url: "https://b" }],
    }
    const merged = mergeAcademicSearchResponses([r1, r2], "q1 | q2")
    expect(merged.total).toBe(2)
    expect(merged.results.map((x) => x.url)).toEqual(["https://a", "https://b"])
  })
})

/**
 * 回归：纯中文主题不在 cnMap 映射表里时，历史实现把主题替换成 "AI research"，
 * 扩写后的三条检索式全部丢失原主题（实测「图神经网络推荐系统」「联邦学习隐私保护」
 * 都被降级），对中文用户等于随机检索。
 */
describe("extractResearchTopic for Chinese topics", () => {
  it("keeps the Chinese topic instead of collapsing to a generic phrase", () => {
    const topic = extractResearchTopic("图神经网络在推荐系统中的应用综述", "图神经网络 推荐系统")
    expect(topic).not.toBe("AI research")
    expect(topic).toContain("图神经网络")
    expect(topic).toContain("推荐系统")
  })

  it("strips intent filler words from the preserved topic", () => {
    const topic = extractResearchTopic("请帮我调研联邦学习隐私保护的最新进展", "")
    expect(topic).not.toBe("AI research")
    expect(topic).not.toContain("帮我")
    expect(topic).not.toContain("最新进展")
    expect(topic).toContain("联邦学习")
  })

  it("propagates the Chinese topic into expanded queries", () => {
    const qs = expandSearchQueries("图神经网络在推荐系统中的应用综述", "图神经网络 推荐系统")
    expect(qs).toHaveLength(3)
    const joined = qs.join(" | ")
    expect(joined).toContain("图神经网络")
    expect(joined).not.toContain("AI research")
  })

  it("still maps known English and Chinese domains to canonical terms", () => {
    expect(extractResearchTopic("LLM 综述", "LLM")).toBe("LLM")
    expect(extractResearchTopic("大语言模型综述", "")).toBe("large language models")
    expect(extractResearchTopic("computer vision survey", "")).toBe("computer vision")
  })
})
