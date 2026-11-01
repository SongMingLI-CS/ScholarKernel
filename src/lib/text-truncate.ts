/**
 * UTF-16 安全截断。
 *
 * JavaScript 的字符串长度与 `slice` 都按 UTF-16 码元计，而 emoji、部分 CJK 扩展字、
 * 数学符号占**两个**码元（代理对）。`str.slice(0, n)` 一旦切在代理对中间，就会留下
 * 一个孤立的高位代理（`\ud83d`）—— 渲染出来是 `�`，写进数据库是不可逆的坏字符，
 * `JSON.stringify` 会把它转义成 `\udXXX`，多数服务端按 UTF-8 解码后直接报错。
 *
 * 这里统一处理：按码元截断，但不切开代理对。
 */
export function truncateUtf16(value: string, limit: number, suffix = ""): string {
  if (!Number.isFinite(limit)) return value
  const max = Math.max(0, Math.floor(limit))
  if (max === 0) return ""
  if (value.length <= max) return value

  const budget = Math.max(0, max - suffix.length)
  let out = value.slice(0, budget)
  // 末尾若是高位代理，说明它对应的低位代理被切掉了：丢掉这半个字符
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1)
  return out + suffix
}

/** 是否存在孤立代理（用于自检与测试，不参与生产逻辑）。 */
export function hasLoneSurrogate(value: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)
}
