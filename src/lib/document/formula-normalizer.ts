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

const LATEX_ENV_RE =
  /\\begin\{(equation|align|gather|multline|matrix|pmatrix|bmatrix|vmatrix|Bmatrix|cases|array)\*?\}([\s\S]*?)\\end\{\1\*?\}/g

const RAW_LATEX_COMMAND_RE =
  /\\(?:sum|prod|int|iint|iiint|oint|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|omega|partial|nabla|sqrt|frac|left|right|cdot|times|leq|geq|neq|approx|pm|infty|log|exp|sin|cos|tan|max|min|arg|lim|sup|inf|mathbb|mathcal|mathrm|mathbf|vec|hat|bar|tilde|overline|underline)\b/

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

  out = out.replace(LATEX_ENV_RE, (_m, _env: string, body: string) => `\n$$\n${body.trim()}\n$$\n`)

  return out
}

/** 修复裸露的上标/下标、分数与 LaTeX 命令，包裹为行内 `$...$`。 */
export function repairRawMathDelimiters(text: string): string {
  return mapOutsideMathDelimiters(text, (segment) => {
    let out = segment

    out = out.replace(
      /(?<![$\\])(\b[A-Za-z][A-Za-z0-9]*(?:_\{[^}]+\}|_\{[^}]+\,\s*[^}]+\}|\^[^{\s][A-Za-z0-9]*|\^\{[^}]+\})+)/g,
      (m) => {
        if (m.includes("http")) return m
        return `$${m}$`
      }
    )

    out = out.replace(/(?<![$])(\\(?:frac|sqrt)\{[^}]+\}(?:\{[^}]+\})?)/g, (m) => `$${m}$`)

    out = out.replace(
      /(?<![$])(\\(?:sum|prod|int|iint|iiint|oint)[\s\S]{0,120}?)(?=[\s,.;:!?\n]|$)/g,
      (m) => {
        const t = m.trim()
        if (!t || !RAW_LATEX_COMMAND_RE.test(t)) return m
        return `$${t}$`
      }
    )

    return out
  })
}

function mapOutsideMathDelimiters(text: string, fn: (segment: string) => string): string {
  const parts = text.split(/(\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g)
  return parts
    .map((part) => {
      if (part.startsWith("$$") || (part.startsWith("$") && part.endsWith("$"))) return part
      return fn(part)
    })
    .join("")
}

/** 行内公式启发式：变量下标、简单分数、希腊字母组合。 */
export function wrapInlineFormulas(text: string): string {
  return mapOutsideMathDelimiters(text, (segment) => {
    let out = segment

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
      /(?<![$\\])(\b[a-zA-Z]\s*=\s*[^$\n]{1,120}?)(?=[\s,.;:!?)\]]|$)/g,
      (m) => {
        const t = m.trim()
        if (t.includes("http") || t.includes("://")) return m
        if (/^(Figure|Table|Section|Fig\.|Tab\.)/i.test(t)) return m
        if (t.length < 4) return m
        if (RAW_LATEX_COMMAND_RE.test(t) || /[\^_]/.test(t)) return `$${t}$`
        if (/[=+\-*/^_{}\\]/.test(t) && /[A-Za-z0-9]/.test(t)) return `$${t}$`
        return m
      }
    )

    out = repairRawMathDelimiters(out)
    return out
  })
}

function dedupeAdjacentMathDelimiters(text: string): string {
  return text
    .replace(/\${3,}/g, "$$")
    .replace(/\$\s+\$/g, " ")
    .replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner: string) => {
      const cleaned = inner.replace(/\$([^$\n]+)\$/g, "$1").trim()
      return `$$${cleaned}$$`
    })
}

/** 检测文本是否含数学符号（用于测试与流水线分支）。 */
export function containsMathSignals(text: string): boolean {
  if (RAW_LATEX_COMMAND_RE.test(text)) return true
  if (/[\^_]|\\begin\{(matrix|pmatrix|bmatrix)/.test(text)) return true
  for (const sym of Object.keys(UNICODE_MATH_MAP)) {
    if (text.includes(sym)) return true
  }
  return false
}

/** 完整公式规范化流水线。 */
export function normalizeAcademicFormulas(text: string): string {
  const step1 = replaceUnicodeMathSymbols(text)
  const step2 = wrapDisplayEquations(step1)
  const step3 = dedupeAdjacentMathDelimiters(wrapInlineFormulas(step2))
  return step3.replace(/\n{4,}/g, "\n\n\n").trim()
}
