import { inflateRawSync, inflateSync } from "node:zlib"

import type { LayoutTextBlock, PageGeometry } from "@/lib/document/column-reorder"

type PdfExtractResult = {
  text: string
  blocks: LayoutTextBlock[]
  pageGeometries: PageGeometry[]
}

/** 内容流是否被 FlateDecode 压缩（`/Filter /FlateDecode` 或 `/Filter [/FlateDecode]`）。 */
const FLATE_FILTER_RE = /\/Filter\s*(?:\[\s*)?\/FlateDecode/

/**
 * TJ 数组里「这是一个词间空格」的字距阈值（单位 1/1000 em）。
 * 字偶距通常在 -10 ~ -50；生成器用 -100 及更大的负位移代替空格。
 */
const TJ_WORD_GAP_THRESHOLD = -100

/**
 * 解压 FlateDecode 内容流。
 *
 * 真实 PDF 的内容流几乎都是压缩的（LaTeX / Word / Acrobat 默认如此），
 * 不解压的话一个 `BT` / `Tj` 都扫不到，只能落到乱码兜底 ——
 * 表现为「上传正常 PDF，检索与审稿拿到一堆噪声」。
 *
 * 输入是 latin1 解码后的字符串，`Buffer.from(..., "latin1")` 能逐字节还原。
 * 先试 zlib（带 2 字节头，绝大多数），失败再试裸 deflate。解不开返回 `null`：
 * 宁可丢掉这一条流，也不要把压缩字节当正文喂给下游。
 */
export function inflatePdfStream(rawLatin1: string): string | null {
  const bytes = Buffer.from(rawLatin1, "latin1")
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      return fn(bytes).toString("latin1")
    } catch {
      // 换下一种包装格式
    }
  }
  return null
}

/**
 * PDF 字面量串（`(...)`）解码，规则见规范 7.3.4.2。
 *
 * 旧实现是 6 行链式 `replace`，三处与规范不符：
 *
 * 1. **顺序**：`/\\n/` 先于 `/\\\\/` 执行，于是 PDF 字节 `a\\nb`
 *    （转义的反斜杠 + 字母 n）被吃成「a + 反斜杠 + 换行」。规范要求 `a\nb`。
 * 2. **八进制转义 `\ddd` 完全没实现**：`\050A\051` 是 `(A)`，
 *    LaTeX / Word 生成的 PDF 里很常见，旧行为是原样输出反斜杠数字。
 * 3. **续行**：`\` 后紧跟 EOL 表示「什么也不产生」，旧行为留下一个反斜杠 + 换行。
 *
 * 链式 replace 本身就不可能对 —— 每个 `replace` 都重新扫描整串，
 * 前一步产出的字符会被后一步当成新的转义起点。改成单遍扫描。
 */
const PDF_SIMPLE_ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "(": "(",
  ")": ")",
  "\\": "\\",
}

function isPdfOctalDigit(ch: string): boolean {
  return ch >= "0" && ch <= "7"
}

function decodePdfLiteral(s: string): string {
  if (!s.includes("\\")) return s
  let out = ""
  let i = 0
  while (i < s.length) {
    const ch = s[i]!
    if (ch !== "\\") {
      out += ch
      i += 1
      continue
    }
    const next = s[i + 1]
    if (next === undefined) {
      // 末尾孤立反斜杠：规范未定义，丢弃而不是输出
      i += 1
      continue
    }
    // 续行：\ 后跟 CRLF / CR / LF，不产生任何字符
    if (next === "\r") {
      i += s[i + 2] === "\n" ? 3 : 2
      continue
    }
    if (next === "\n") {
      i += 2
      continue
    }
    const simple = PDF_SIMPLE_ESCAPES[next]
    if (simple !== undefined) {
      out += simple
      i += 2
      continue
    }
    // 八进制：1~3 位，取低 8 位
    if (isPdfOctalDigit(next)) {
      let digits = ""
      let k = i + 1
      while (k < s.length && digits.length < 3 && isPdfOctalDigit(s[k]!)) {
        digits += s[k]
        k += 1
      }
      out += String.fromCharCode(Number.parseInt(digits, 8) & 0xff)
      i = k
      continue
    }
    // 未定义的转义：规范要求忽略反斜杠，保留字符本身
    out += next
    i += 2
  }
  return out
}

const PDF_WHITESPACE = new Set([" ", "\n", "\r", "\t", "\f", "\0"])

/**
 * 内容流分词。
 *
 * 旧实现是一条正则：`/\((?:\\(?:[\s\S])|[^\\)])*\)|<[0-9A-Fa-f\s]*>|[[\]]|[^\s]+/g`。
 * 它的字面量分支在**第一个** `)` 处收尾，而 PDF 允许字面量里出现平衡括号：
 * `(Outer (Inner) Tail)` 会被切成 `(Outer (Inner)` + `Tail)`，
 * 于是 `Tj` 取到的操作数是 `Tail)`，不以 `(` 开头 → **整段文字被静默丢弃**。
 *
 * 正则做不了任意深度的括号配对，这里改成显式扫描：`(` 进 `(` 出、按深度配对，
 * 遇到 `\` 跳过下一个字节（含八进制与续行，转义里的 `(` 不参与配对）。
 */
function tokenizeContentStream(stream: string): string[] {
  const tokens: string[] = []
  const n = stream.length
  let i = 0
  while (i < n) {
    const ch = stream[i]!
    if (PDF_WHITESPACE.has(ch)) {
      i += 1
      continue
    }
    if (ch === "%") {
      while (i < n && stream[i] !== "\n" && stream[i] !== "\r") i += 1
      continue
    }
    if (ch === "(") {
      const start = i
      let depth = 0
      while (i < n) {
        const c = stream[i]!
        if (c === "\\") {
          i += 2
          continue
        }
        if (c === "(") {
          depth += 1
          i += 1
          continue
        }
        if (c === ")") {
          depth -= 1
          i += 1
          if (depth === 0) break
          continue
        }
        i += 1
      }
      tokens.push(stream.slice(start, i))
      continue
    }
    if (ch === "<") {
      if (stream[i + 1] === "<") {
        tokens.push("<<")
        i += 2
        continue
      }
      const start = i
      i += 1
      while (i < n && stream[i] !== ">") i += 1
      if (i < n) i += 1
      tokens.push(stream.slice(start, i))
      continue
    }
    if (ch === "[" || ch === "]") {
      tokens.push(ch)
      i += 1
      continue
    }
    const start = i
    while (i < n) {
      const c = stream[i]!
      if (PDF_WHITESPACE.has(c) || c === "(" || c === ")" || c === "<" || c === "[" || c === "]") break
      i += 1
    }
    // 防御：任何未预期字符都要能前进，否则这里会变成死循环（本项目栽过两次）
    if (i === start) {
      i += 1
      continue
    }
    tokens.push(stream.slice(start, i))
  }
  return tokens
}

function decodePdfHex(hex: string): string {
  const clean = hex.replace(/\s+/g, "")
  if (!clean) return ""
  let out = ""
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.slice(i, i + 2), 16)
    if (!Number.isNaN(byte)) out += String.fromCharCode(byte)
  }
  return out
}

/** 从 PDF 对象树提取各页 MediaBox 宽度（用于双栏中轴线判定）。 */
export function extractPdfPageGeometries(buffer: Buffer): PageGeometry[] {
  const raw = buffer.toString("latin1")
  const geometries: PageGeometry[] = []
  const mediaRe = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/g
  let page = 0
  let m: RegExpExecArray | null
  while ((m = mediaRe.exec(raw)) !== null) {
    page += 1
    const x0 = parseFloat(m[1]!)
    const y0 = parseFloat(m[2]!)
    const x1 = parseFloat(m[3]!)
    const y1 = parseFloat(m[4]!)
    if ([x0, y0, x1, y1].some((v) => Number.isNaN(v))) continue
    geometries.push({
      page,
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0),
    })
  }
  return geometries
}

type PdfObjectSpan = { objNum: number; start: number; end: number; body: string }

/** 收集每个间接对象在原文中的区间，用于把 stream 归属到持有它的对象。 */
function collectPdfObjectSpans(raw: string): PdfObjectSpan[] {
  const headRe = /(\d+)\s+(\d+)\s+obj\b/g
  const heads: Array<{ objNum: number; start: number }> = []
  let m: RegExpExecArray | null
  while ((m = headRe.exec(raw)) !== null) {
    heads.push({ objNum: Number(m[1]), start: headRe.lastIndex })
  }

  const spans: PdfObjectSpan[] = []
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i]!
    const nextStart = heads[i + 1]?.start ?? raw.length
    const endobj = raw.indexOf("endobj", head.start)
    const end = endobj >= 0 && endobj < nextStart ? endobj : nextStart
    spans.push({ objNum: head.objNum, start: head.start, end, body: raw.slice(head.start, end) })
  }
  return spans
}

/**
 * 建立「内容流对象号 → 页码」的映射。
 *
 * PDF 的 /Contents 可以是单个引用，也可以是数组（一页由多个内容流拼成）。
 * 早先实现按 `stream` 出现次数递增页码，一旦某页有多个内容流，
 * 后续所有页码都会整体偏移 —— 而 MediaBox 仍按页对象计数，
 * 于是 block.page 与 pageGeometries 直接对不上。
 */
function buildContentPageMap(spans: PdfObjectSpan[]): Map<number, number> {
  const map = new Map<number, number>()
  let pageIndex = 0
  for (const span of spans) {
    // /Type /Pages 是页树节点，不是页本身
    if (!/\/Type\s*\/Page(?![sS])/.test(span.body)) continue
    pageIndex += 1
    const contents = span.body.match(/\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/)
    if (!contents) continue
    for (const ref of contents[1]!.matchAll(/(\d+)\s+\d+\s+R/g)) {
      map.set(Number(ref[1]), pageIndex)
    }
  }
  return map
}

/** 从 PDF content stream 片段提取带坐标的文本块（Tm/Td/Tj/TJ）。 */
export function extractPdfLayoutBlocks(buffer: Buffer): PdfExtractResult {
  const raw = buffer.toString("latin1")
  const blocks: LayoutTextBlock[] = []
  const pageGeometries = extractPdfPageGeometries(buffer)
  const spans = collectPdfObjectSpans(raw)
  const contentPageMap = buildContentPageMap(spans)

  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let sequentialPage = 0

  const flushText = (text: string, x: number, y: number, page: number) => {
    const t = text.replace(/\s+/g, " ").trim()
    if (t.length < 2) return
    blocks.push({ text: t, x, y, page })
  }

  let match: RegExpExecArray | null
  while ((match = streamRe.exec(raw)) !== null) {
    const streamStart = match.index
    const owner = spans.find((s) => streamStart >= s.start && streamStart <= s.end)
    const mapped = owner ? contentPageMap.get(owner.objNum) : undefined
    let page: number
    if (mapped !== undefined) {
      page = mapped
    } else {
      // 结构不完整（流式生成、缺少页对象引用）时退回「按 stream 递增」
      sequentialPage += 1
      page = sequentialPage
    }

    const rawStream = match[1] ?? ""
    // 流字典在 `stream` 之前：压缩流必须先解压再 token 化，否则扫不到任何操作符
    const ownerDict = owner ? owner.body.slice(0, Math.max(0, streamStart - owner.start)) : ""
    let stream = rawStream
    if (FLATE_FILTER_RE.test(ownerDict)) {
      const inflated = inflatePdfStream(rawStream)
      if (inflated === null) continue
      stream = inflated
    }
    let x = 0
    let y = 0
    let leading = 0
    let pending = ""

    // 字面量串 / 十六进制串必须排在裸 token 之前：若 `[^\s]+` 在前，
    // `(First page body)` 会被空格切成三段，Tj 的操作数就取不到了。
    // 方括号单独成 token，才能把 `[ (A) -20 (B) ]` 还原成一个 TJ 数组。
    const tokens = tokenizeContentStream(stream)
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!
      // 注意：这里不能把 i 往回拨。操作数已经通过 tokens[i - n] 直接读取，
      // 回拨只会在 for 的 i++ 补偿下回到原位，形成死循环（Tj / TJ 曾是死循环）。
      // Tm 操作数是 6 个矩阵元素 a b c d e f Tm；位置取平移分量 (e, f)。
      // 旧代码取 tokens[i-4]（c 分量）作为 tx，对单位矩阵 1 0 0 1 e f 会读成 0。
      if (tok === "Tm" && i >= 6) {
        const ty = parseFloat(tokens[i - 1]!) // f
        const tx = parseFloat(tokens[i - 2]!) // e
        if (!Number.isNaN(tx)) x = tx
        if (!Number.isNaN(ty)) y = ty
        continue
      }
      if (tok === "Td" && i >= 2) {
        const dy = parseFloat(tokens[i - 1]!)
        const dx = parseFloat(tokens[i - 2]!)
        if (!Number.isNaN(dx)) x += dx
        if (!Number.isNaN(dy)) y += dy
        continue
      }
      // TD：设置行首距 leading = -dy，再做 Td(dx, dy)
      if (tok === "TD" && i >= 2) {
        const dy = parseFloat(tokens[i - 1]!)
        const dx = parseFloat(tokens[i - 2]!)
        if (!Number.isNaN(dy)) leading = -dy
        if (!Number.isFinite(leading)) leading = 0
        if (!Number.isNaN(dx)) x += dx
        if (!Number.isNaN(dy)) y += dy
        continue
      }
      // TL：直接设置行首距
      if (tok === "TL" && i >= 1) {
        const n = parseFloat(tokens[i - 1]!)
        if (!Number.isNaN(n)) leading = n
        continue
      }
      if (tok === "Tj" && i >= 1) {
        const prev = tokens[i - 1]!
        if (prev.startsWith("(")) pending += decodePdfLiteral(prev.slice(1, -1))
        else if (prev.startsWith("<")) pending += decodePdfHex(prev.slice(1, -1))
        continue
      }
      if (tok === "TJ") {
        // TJ 的操作数是一个以 `[` 开头、以 `]` 结尾的数组，中间夹着字距调整数字，
        // 因此不能只看 tokens[i-1]。先跳过结尾的 `]`，再向前找未闭合的 `[`。
        let j = i - 1
        if (j >= 0 && tokens[j] === "]") j -= 1
        while (j >= 0 && tokens[j] !== "[" && tokens[j] !== "]") j--
        if (j >= 0 && tokens[j] === "[") {
          // 字距调整量以 1/1000 em 计：小负数只是字偶距（-20 = 0.02em），
          // 达到 0.1em 量级才是 PDF 生成器用来代替空格的分词位移。
          // 不还原的话 `[(Hello) -300 (World)]` 会拼成 `HelloWorld`，
          // 下游分词、检索、引用对齐全部受影响。
          let sawWordGap = false
          for (const p of tokens.slice(j + 1, i)) {
            const kern = Number(p)
            if (Number.isFinite(kern) && p.trim() !== "") {
              if (kern <= TJ_WORD_GAP_THRESHOLD) sawWordGap = true
              continue
            }
            if (p.startsWith("(")) {
              if (sawWordGap && pending && !pending.endsWith(" ")) pending += " "
              sawWordGap = false
              pending += decodePdfLiteral(p.slice(1, -1))
            } else if (p.startsWith("<") && !p.startsWith("<<")) {
              if (sawWordGap && pending && !pending.endsWith(" ")) pending += " "
              sawWordGap = false
              pending += decodePdfHex(p.slice(1, -1))
            }
          }
        }
        continue
      }
      // T*：移到下一行首。先 flush 当前 pending（用旧 y），再 y -= leading
      // 为后续文本准备新位置。顺序反了会把前一行也挪到新 y。
      if (tok === "T*") {
        if (pending.trim()) flushText(pending, x, y, page)
        pending = ""
        y -= leading
        continue
      }
      if (tok === "ET" || tok === "Q") {
        if (pending.trim()) flushText(pending, x, y, page)
        pending = ""
      }
    }
    if (pending.trim()) flushText(pending, x, y, page)
  }

  if (blocks.length === 0) {
    const fallback = extractPdfPlainText(raw)
    return { text: fallback, blocks: [], pageGeometries }
  }

  // 不在此处做 naive 排序拼接；交由 column-reorder 按双栏阅读顺序重组。
  return { text: blocks.map((b) => b.text).join("\n"), blocks, pageGeometries }
}

/** 无坐标时的纯文本兜底：抓取 (..) 与 <hex> 字串。 */
export function extractPdfPlainText(rawLatin1: string): string {
  const chunks: string[] = []
  const litRe = /\((?:\\.|[^\\)])*\)/g
  let m: RegExpExecArray | null
  while ((m = litRe.exec(rawLatin1)) !== null) {
    const decoded = decodePdfLiteral(m[0].slice(1, -1)).trim()
    if (decoded.length >= 2) chunks.push(decoded)
  }
  const hexRe = /<([0-9A-Fa-f\s]{4,})>/g
  while ((m = hexRe.exec(rawLatin1)) !== null) {
    const decoded = decodePdfHex(m[1] ?? "").trim()
    if (decoded.length >= 2) chunks.push(decoded)
  }
  return chunks.join("\n")
}

export function extractPdfFromBuffer(buffer: Buffer): PdfExtractResult {
  return extractPdfLayoutBlocks(buffer)
}
