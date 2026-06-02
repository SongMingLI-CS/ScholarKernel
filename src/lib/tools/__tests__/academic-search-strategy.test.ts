import { describe, expect, it } from "vitest"

import {
  buildDualSearchQueries,
  expandSearchQueries,
  formatResearchHitLines,
  isBroadTopicQuery,
  isSurveyOrProgressTopic,
  mergeAcademicSearchHits,
  mergeAcademicSearchResponses,
  resolveResearchQueryList,
  serializeResearchOutputForReasoning,
} from "@/lib/tools/academic-search-strategy"
import type { AcademicSearchHit, AcademicSearchResponse } from "@/lib/tools/search-tool"

describe("academic-search-strategy", () => {
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
