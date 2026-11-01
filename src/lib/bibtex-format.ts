/**
 * BibTeX / RIS 的字段级格式规则，供两套导出实现共用。
 *
 * 这里存在的理由很直接：`citation-export.ts`（对话里的来源列表）和
 * `utils/citation-parser.ts`（导入的参考文献）各自实现了一遍序列化，
 * 修好一处不影响另一处 —— 同一个产品里两种转义行为，用户只会看到「有时正常」。
 */

/** 记录型格式（RIS）与 BibTeX 都不允许字段里出现裸换行，先折成空格。 */
export function collapseWhitespace(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/[ \t]{2,}/g, " ").trim()
}

const BIBTEX_ESCAPE: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
}

/**
 * 单次扫描转义。
 *
 * 不能「先把反斜杠替换成 `\textbackslash{}`，再替换花括号」—— 第二步会把自己
 * 刚插入的 `{}` 又转义一遍。凡「替换结果包含被搜索字符」的转换都要一次完成。
 */
export function escapeBibTeXField(value: string): string {
  return collapseWhitespace(value).replace(/[\\&%$#_{}~^]/g, (c) => BIBTEX_ESCAPE[c] ?? c)
}

/** BibTeX 的 year 字段要求四位年份，而来源常常带完整日期。 */
export function bibTeXYear(raw: string): string | null {
  const m = /(?:^|\D)(\d{4})(?:\D|$)/.exec(raw)
  return m ? m[1]! : null
}

/**
 * 引用键必须唯一：两篇标题前缀相同的文献会算出同一个键，
 * BibTeX 直接报重复条目，全库引用一起错位。
 */
export function uniqueBibTeXKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let n = 2
  while (used.has(`${base}${n}`)) n += 1
  const key = `${base}${n}`
  used.add(key)
  return key
}

/** 从标题取前三词拼引用键；中文标题会被过滤成空，此时回落到 `fallback`。 */
export function bibTeXKeyFromTitle(title: string, fallback: string): string {
  const fromTitle = title
    .replace(/[^\w\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("")
  return (fromTitle || fallback).replace(/\W/g, "") || fallback
}
