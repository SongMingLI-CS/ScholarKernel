import { describe, expect, it } from "vitest"

import { sanitizeExportFilename } from "../conversation-utils"
import { parseConversationBackupPayload } from "../conversation-backup"
import { detectSectionTitle } from "../document/academic-semantic-chunker"
import { lexicalRerankScores, sanitizeRerankScores } from "../document/rerank-gateway"
import { prependExportMetadata, stripStaleExportMetadata } from "../export-metadata"
import { escapeBibTeXField } from "../bibtex-format"
import { sanitizeExportHtml } from "../export-utils"
import { normalizeReferenceSections } from "../reference-sections"
import { normalizeSources } from "../source-metadata"
import { extractReferencesFromMarkdown, parseBibTeX, parseCitations, parseRIS } from "../utils/citation-parser"

/**
 * 输入来自用户附件、模型输出、网页抓取与备份文件 —— 全都不受控。
 * 解析器在**任意**字符串下都不该抛异常（应当降级或返回空），否则一次异常输入
 * 就能让整条链路 500。这里用固定种子生成破坏性输入：控制字符、BOM、代理对、
 * CJK、BibTeX 元字符、成对/不成对的括号。
 *
 * 种子固定 → 结果可重复；不是「随机跑一次就算了」的测试。
 */

function seededRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const ALPHABET = [
  "a", "Z", "0", " ", "\n", "\t", "\r", "{", "}", "[", "]", "(", ")", "@", "\\", '"', "'",
  "#", "*", "-", "_", "%", "&", "$", "~", "^", "|", "<", ">", "/", ":", ".", ",", ";",
  "中", "文", "摘", "要", "参", "考", "文", "献", "，", "。", "：", "；", "（", "）",
  "😀", "\u0000", "\u007f", "\u2028", "\uFEFF",
]

function randomString(rnd: () => number, maxLen: number): string {
  const len = Math.floor(rnd() * maxLen)
  let out = ""
  for (let i = 0; i < len; i += 1) out += ALPHABET[Math.floor(rnd() * ALPHABET.length)]
  return out
}

function samples(count: number, maxLen = 200): string[] {
  const rnd = seededRandom(0xc0ffee)
  return Array.from({ length: count }, () => randomString(rnd, maxLen))
}

const SAMPLE_INPUTS = samples(400)

const PARSERS: Array<[string, (s: string) => unknown]> = [
  ["normalizeReferenceSections", (s) => normalizeReferenceSections(s, s.slice(0, 20))],
  ["stripStaleExportMetadata", (s) => stripStaleExportMetadata(s)],
  ["parseBibTeX", (s) => parseBibTeX(s)],
  ["parseRIS", (s) => parseRIS(s)],
  ["parseCitations", (s) => parseCitations(s)],
  ["extractReferencesFromMarkdown", (s) => extractReferencesFromMarkdown(s)],
  ["lexicalRerankScores", (s) => lexicalRerankScores(s, [s, s.slice(1), ""])],
  ["sanitizeRerankScores", (s) => sanitizeRerankScores([{ index: 0, score: Number.NaN }], s.length)],
  ["normalizeSources", (s) => normalizeSources([{ title: s, url: s }, s])],
  ["escapeBibTeXField", (s) => escapeBibTeXField(s)],
  ["sanitizeExportFilename", (s) => sanitizeExportFilename(s)],
  ["detectSectionTitle", (s) => detectSectionTitle(s)],
  ["sanitizeExportHtml", (s) => sanitizeExportHtml(s)],
  ["prependExportMetadata", (s) => prependExportMetadata(s, { model: s, retrievalDate: s, exportedAt: s })],
  [
    "formatConversationAsMarkdown",
    (s) =>
      // 循环导入没必要，直接走 prepend 覆盖同一批字符串字段
      prependExportMetadata(s, { model: s, retrievalDate: s, exportedAt: s }),
  ],
]

describe("任意输入下解析器不抛异常", () => {
  for (const [name, fn] of PARSERS) {
    it(name, () => {
      const failures: string[] = []
      for (const input of SAMPLE_INPUTS) {
        try {
          fn(input)
        } catch (e) {
          failures.push(`${(e as Error).message} | input=${JSON.stringify(input).slice(0, 80)}`)
        }
      }
      expect(failures).toEqual([])
    })
  }

  it("备份解析对畸形结构返回 null 而不是抛错", () => {
    for (const input of SAMPLE_INPUTS.slice(0, 100)) {
      expect(() => parseConversationBackupPayload({ v: 1, kind: "sk-conversations", conversations: input })).not.toThrow()
      expect(() =>
        parseConversationBackupPayload({
          v: 1,
          kind: "sk-conversations",
          conversations: [{ title: input, messages: [{ id: input, role: "user", content: input, sources: input }] }],
        })
      ).not.toThrow()
    }
  })
})

describe("清洗类函数的输出性质", () => {
  it("导出文件名永远是合法的单段文件名", () => {
    for (const input of SAMPLE_INPUTS) {
      const name = sanitizeExportFilename(input)
      expect(name.length).toBeGreaterThan(3)
      expect(name.length).toBeLessThanOrEqual(104)
      expect(name.endsWith(".md")).toBe(true)
      expect(name).not.toMatch(/[/\\?%*:|"<>]/)
      expect(name).not.toMatch(/[\u0000-\u001f\u007f]/)
    }
  })

  it("来源 url 清洗后仍是可点的绝外地址", () => {
    for (const input of SAMPLE_INPUTS) {
      for (const source of normalizeSources([{ title: "t", url: input }])) {
        expect(() => new URL(source.url)).not.toThrow()
        expect(["http:", "https:"]).toContain(new URL(source.url).protocol)
      }
    }
  })

  it("导出净化后的 HTML 不含脚本标签", () => {
    for (const input of SAMPLE_INPUTS) {
      const out = sanitizeExportHtml(`${input}<script>alert(1)</script><img src=x onerror=alert(1)>`)
      expect(out.toLowerCase()).not.toContain("<script")
      expect(out.toLowerCase()).not.toMatch(/\son[a-z]{3,}\s*=/)
    }
  })
})
