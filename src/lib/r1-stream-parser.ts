/** DeepSeek-R1 思考流双轨解析器 — 将 SSE 增量文本分流至 thinkingText / finalResponse。 */

export const R1_THINKING_OPEN_TAG = "<" + "redacted_thinking" + ">"
export const R1_THINKING_CLOSE_TAG = "</" + "redacted_thinking" + ">"

export type R1StreamTrack = "response" | "thinking"

export type R1StreamSnapshot = {
  track: R1StreamTrack
  thinkingText: string
  finalResponse: string
  thinkingComplete: boolean
}

export type R1StreamParseResult = R1StreamSnapshot & {
  /** 本 chunk 是否刚完成思考段（捕捉到闭合标签） */
  justCompletedThinking: boolean
}

function maxIncompleteTagPrefixLen(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1)
  for (let k = max; k > 0; k--) {
    const suffix = text.slice(-k)
    if (tag.startsWith(suffix)) return k
  }
  return 0
}

function findTagIndex(haystack: string, tag: string): number {
  return haystack.indexOf(tag)
}

export function createR1StreamParser(initial?: Partial<R1StreamSnapshot>) {
  let track: R1StreamTrack = initial?.track ?? "response"
  let thinkingText = initial?.thinkingText ?? ""
  let finalResponse = initial?.finalResponse ?? ""
  let thinkingComplete = initial?.thinkingComplete ?? false
  let pending = ""

  const snapshot = (): R1StreamSnapshot => ({
    track,
    thinkingText,
    finalResponse,
    thinkingComplete,
  })

  const append = (chunk: string): R1StreamParseResult => {
    if (!chunk) {
      return { ...snapshot(), justCompletedThinking: false }
    }

    let justCompletedThinking = false
    pending += chunk

    while (pending.length > 0) {
      const activeTag = track === "response" ? R1_THINKING_OPEN_TAG : R1_THINKING_CLOSE_TAG
      const tagAt = findTagIndex(pending, activeTag)

      if (tagAt >= 0) {
        const before = pending.slice(0, tagAt)
        if (before) {
          if (track === "response") finalResponse += before
          else thinkingText += before
        }
        pending = pending.slice(tagAt + activeTag.length)

        if (track === "response") {
          track = "thinking"
        } else {
          track = "response"
          thinkingComplete = true
          justCompletedThinking = true
        }
        continue
      }

      const hold = maxIncompleteTagPrefixLen(pending, activeTag)
      const emitLen = pending.length - hold
      if (emitLen <= 0) break

      const emit = pending.slice(0, emitLen)
      pending = pending.slice(emitLen)
      if (track === "response") finalResponse += emit
      else thinkingText += emit
    }

    return { ...snapshot(), justCompletedThinking }
  }

  /** 流结束时冲刷残余 pending（不含未闭合标签前缀） */
  const flush = (): R1StreamSnapshot => {
    if (pending) {
      const activeTag = track === "response" ? R1_THINKING_OPEN_TAG : R1_THINKING_CLOSE_TAG
      const hold = maxIncompleteTagPrefixLen(pending, activeTag)
      const emit = pending.slice(0, pending.length - hold)
      if (emit) {
        if (track === "response") finalResponse += emit
        else thinkingText += emit
      }
      pending = pending.slice(pending.length - hold)
    }
    return snapshot()
  }

  return { append, flush, snapshot }
}

/** 从完整文本一次性解析（用于测试与兜底） */
export function parseR1StreamText(raw: string): R1StreamSnapshot {
  const parser = createR1StreamParser()
  parser.append(raw)
  return parser.flush()
}

const R1_TAG_NAME = "redacted_thinking"
const R1_THINKING_BLOCK_RE = new RegExp(`<${R1_TAG_NAME}>[\\s\\S]*?<\\/${R1_TAG_NAME}>`, "gi")
const R1_THINKING_UNCLOSED_RE = new RegExp(`<${R1_TAG_NAME}>[\\s\\S]*$`, "i")
const R1_THINKING_TAG_RE = new RegExp(`<\\/?${R1_TAG_NAME}>`, "gi")
const R1_THINKING_PARTIAL_TAIL_RE = new RegExp(`<\\/?${R1_TAG_NAME}[^>]*$`, "i")
const R1_THINKING_PARTIAL_OPEN_TAIL_RE = /<redacted_th[^>]*$/i

/** 擦除所有思考标签与内容，供 Canvas / 聊天气泡安全渲染 */
export function stripRedactedThinking(raw: string): string {
  if (!raw) return ""
  let out = raw.replace(R1_THINKING_BLOCK_RE, "")
  out = out.replace(R1_THINKING_UNCLOSED_RE, "")
  out = out.replace(R1_THINKING_TAG_RE, "")
  out = out.replace(R1_THINKING_PARTIAL_TAIL_RE, "")
  out = out.replace(R1_THINKING_PARTIAL_OPEN_TAIL_RE, "")
  return out.replace(/\n{3,}/g, "\n\n").trim()
}
