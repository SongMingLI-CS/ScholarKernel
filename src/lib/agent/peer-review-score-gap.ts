/**
 * ASCII 词边界不能用 `\b`。
 *
 * `\b` 成立的前提是一侧为 `\w`（即 [A-Za-z0-9_]），而中日韩字符不属于 `\w`：
 * `\b录用\b` 在「建议录用」里永远匹配不上，`\b评分\b` 在「评分：8」里同样失败。
 * 于是中文审稿结论与中文评分曾是整段死代码 —— 产品本身输出中文审稿意见，
 * 人类介入断点的 reason 只剩泛化的「Wait for expert guidance」，
 * 审稿人分歧这条关键信号被静默丢弃。
 *
 * 改用 ASCII 字母的负向环视：对中文无副作用（中文不是 A-Za-z），
 * 对英文仍能挡住 accepted / scored 这类变形。
 */
const LEFT = "(?<![A-Za-z])"
const RIGHT = "(?![A-Za-z])"

const ACCEPT_VERDICT = new RegExp(
  `${LEFT}(?:accept|weak\\s*accept|oral|spotlight|录用|接收|小修|minor\\s*revision)${RIGHT}`,
  "i"
)
const REJECT_VERDICT = new RegExp(
  `${LEFT}(?:reject|strong\\s*reject|desk\\s*reject|拒稿|大修|major\\s*revision|不予接收|不予录用|不予发表)${RIGHT}`,
  "i"
)

/**
 * 「不予接收」「不予录用」内部含「接收 / 录用」，会同时命中两套关键词，
 * 在 `dominantVerdict` 里退化成 neutral（既不录用也不拒稿）。
 * 判定 acception 前先把这些否定式短语屏蔽掉，让拒稿语义单独成立。
 */
const NEGATED_ACCEPT_PHRASE = /(?:不予|不拟|不同意|未予)(?:接收|录用|发表|刊登)/g
const NEGATED_MASK = "〇〇〇〇"

function maskNegatedAccept(text: string): string {
  return text.replace(NEGATED_ACCEPT_PHRASE, NEGATED_MASK)
}

const NUMERIC_SCORE = new RegExp(
  `${LEFT}(?:score|rating|overall|总分|评分|得分)\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/\\s*(\\d+(?:\\.\\d+)?))?`,
  "gi"
)

/** 统一到 0–10 量纲：`85/100` 与 `8/10` 是同一水平，不应被判成分差 77。 */
const SCORE_SCALE_MAX = 10

function extractNumericScores(text: string): number[] {
  const scores: number[] = []
  for (const m of text.matchAll(NUMERIC_SCORE)) {
    const value = Number(m[1])
    if (!Number.isFinite(value)) continue
    const denomRaw = m[2]
    const denom = denomRaw === undefined ? null : Number(denomRaw)
    if (denom !== null && Number.isFinite(denom) && denom > 0 && denom !== SCORE_SCALE_MAX) {
      scores.push((value / denom) * SCORE_SCALE_MAX)
      continue
    }
    scores.push(value)
  }
  return scores
}

function dominantVerdict(text: string): "accept" | "reject" | "neutral" {
  const accept = ACCEPT_VERDICT.test(maskNegatedAccept(text))
  const reject = REJECT_VERDICT.test(text)
  if (accept && !reject) return "accept"
  if (reject && !accept) return "reject"
  return "neutral"
}

/** 检测 R1/R2 审稿结论或数值评分差距过大，触发人类介入断点。 */
export function hasPeerReviewScoreGap(r1Text: string, r2Text: string): boolean {
  const v1 = dominantVerdict(r1Text)
  const v2 = dominantVerdict(r2Text)
  if (v1 !== "neutral" && v2 !== "neutral" && v1 !== v2) return true

  const s1 = extractNumericScores(r1Text)
  const s2 = extractNumericScores(r2Text)
  if (s1.length > 0 && s2.length > 0) {
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
    const gap = Math.abs(avg(s1) - avg(s2))
    if (gap >= 3) return true
  }

  return false
}

export function shouldTriggerPeerReviewBreakpoint(
  r1Text: string,
  r2Text: string,
  options?: { forceBeforeAreaChair?: boolean }
): boolean {
  if (options?.forceBeforeAreaChair !== false) return true
  return hasPeerReviewScoreGap(r1Text, r2Text)
}
