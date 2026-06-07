const ACCEPT_VERDICT =
  /\b(accept|weak\s*accept|oral|spotlight|录用|接收|小修|minor\s*revision)\b/i
const REJECT_VERDICT =
  /\b(reject|strong\s*reject|desk\s*reject|拒稿|major\s*revision|大修|不予接收)\b/i
const NUMERIC_SCORE = /\b(?:score|rating|overall|总分|评分)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*10)?/gi

function extractNumericScores(text: string): number[] {
  const scores: number[] = []
  for (const m of text.matchAll(NUMERIC_SCORE)) {
    const n = Number(m[1])
    if (Number.isFinite(n)) scores.push(n)
  }
  return scores
}

function dominantVerdict(text: string): "accept" | "reject" | "neutral" {
  const accept = ACCEPT_VERDICT.test(text)
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
