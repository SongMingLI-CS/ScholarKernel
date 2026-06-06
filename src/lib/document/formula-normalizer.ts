const UNICODE_MATH_MAP: Record<string, string> = {
  "α": "\\alpha",
  "β": "\\beta",
  "γ": "\\gamma",
  "δ": "\\delta",
  "ε": "\\epsilon",
  "θ": "\\theta",
  "λ": "\\lambda",
  "μ": "\\mu",
  "π": "\\pi",
  "σ": "\\sigma",
  "φ": "\\phi",
  "ω": "\\omega",
  "∑": "\\sum",
  "∏": "\\prod",
  "∫": "\\int",
  "√": "\\sqrt",
  "∞": "\\infty",
  "≤": "\\leq",
  "≥": "\\geq",
  "≠": "\\neq",
  "≈": "\\approx",
  "±": "\\pm",
  "×": "\\times",
  "÷": "\\div",
  "∈": "\\in",
  "∂": "\\partial",
  "∇": "\\nabla",
}

const DISPLAY_EQUATION_RE =
  /(?:^|\n)\s*(?:Equation|Eq\.?|公式)\s*[\(\[]?\s*(\d+)\s*[\)\]]?\s*[:：]?\s*\n([\s\S]*?)(?=\n\s*(?:Equation|Eq\.?|公式|\d+\.\s+[A-Z])|$)/gi

const NUMBERED_EQUATION_LINE_RE = /(?:^|\n)\s*\((\d+(?:\.\d+)?)\)\s*(.+)$/gm

/** 将常见 Unicode 数学符号替换为 LaTeX 命令。 */
export function replaceUnicodeMathSymbols(text: string): string {
  let out = text
  for (const [sym, latex] of Object.entries(UNICODE_MATH_MAP)) {
    out = out.split(sym).join(latex)
  }
  return out
}

/** 捕获独立公式块 → `$$...$$` */
export function wrapDisplayEquations(text: string): string {
  let out = text.replace(DISPLAY_EQUATION_RE, (_m, _num: string, body: string) => {
    const trimmed = body.trim().replace(/\n{3,}/g, "\n\n")
    if (!trimmed) return ""
    if (trimmed.startsWith("$$") && trimmed.endsWith("$$")) return `\n${trimmed}\n`
    return `\n$$\n${trimmed}\n$$\n`
  })

  out = out.replace(
    /(?:^|\n)\s*\\begin\{(equation|align|gather|multline)\*?\}([\s\S]*?)\\end\{\1\*?\}/g,
    (_m, _env: string, body: string) => `\n$$\n${body.trim()}\n$$\n`
  )

  return out
}

/** 行内公式启发式：变量下标、简单分数、希腊字母组合。 */
export function wrapInlineFormulas(text: string): string {
  let out = text

  out = out.replace(NUMBERED_EQUATION_LINE_RE, (_m, _num: string, expr: string) => {
    const e = expr.trim()
    if (e.startsWith("$")) return _m
    const prefix = _m.startsWith("\n") ? "\n" : ""
    return `${prefix}$$${e}$$`
  })

  out = out.replace(
    /\b([A-Za-z])_\{([^}]+)\}/g,
    (_m, base: string, sub: string) => `$${base}_{${sub}}$`
  )
  out = out.replace(/\b([A-Za-z])_([A-Za-z0-9])/g, (_m, base: string, sub: string) => `$${base}_{${sub}}$`)

  out = out.replace(
    /(?<![$\\])(\b[a-zA-Z]\s*=\s*[^$\n]{1,80}?)(?=[\s,.;:!?)\]]|$)/g,
    (m) => {
      const t = m.trim()
      if (t.includes("http") || t.includes("://")) return m
      if (/^(Figure|Table|Section|Fig\.|Tab\.)/i.test(t)) return m
      if (t.length < 4) return m
      return `$${t}$`
    }
  )

  return dedupeAdjacentMathDelimiters(out)
}

function dedupeAdjacentMathDelimiters(text: string): string {
  return text.replace(/\${3,}/g, "$$")
}

/** 完整公式规范化流水线。 */
export function normalizeAcademicFormulas(text: string): string {
  const step1 = replaceUnicodeMathSymbols(text)
  const step2 = wrapDisplayEquations(step1)
  const step3 = wrapInlineFormulas(step2)
  return step3.replace(/\n{4,}/g, "\n\n\n").trim()
}
