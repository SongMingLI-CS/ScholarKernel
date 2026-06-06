/** 版面块：带坐标时可做精确双栏排序；纯文本时走启发式。 */
export type LayoutTextBlock = {
  text: string
  x: number
  y: number
  page: number
  width?: number
}

export type ColumnReorderResult = {
  text: string
  layout: "single" | "double" | "unknown"
  blocks: number
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/** 基于 x 坐标中位数切分左右栏，按页→栏→y 阅读顺序拼接。 */
export function reorderDoubleColumnBlocks(blocks: LayoutTextBlock[]): ColumnReorderResult {
  const usable = blocks
    .map((b) => ({ ...b, text: b.text.replace(/\s+/g, " ").trim() }))
    .filter((b) => b.text.length > 0)

  if (usable.length === 0) {
    return { text: "", layout: "unknown", blocks: 0 }
  }

  const xs = usable.map((b) => b.x)
  const split = median(xs)
  const left = usable.filter((b) => b.x < split)
  const right = usable.filter((b) => b.x >= split)

  const isDouble =
    left.length >= 3 &&
    right.length >= 3 &&
    Math.abs(left.length - right.length) <= Math.max(left.length, right.length) * 0.75

  if (!isDouble) {
    const single = [...usable].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
    return {
      text: single.map((b) => b.text).join("\n"),
      layout: "single",
      blocks: usable.length,
    }
  }

  const pages = [...new Set(usable.map((b) => b.page))].sort((a, b) => a - b)
  const lines: string[] = []

  for (const page of pages) {
    const sortCol = (col: LayoutTextBlock[]) =>
      col.filter((b) => b.page === page).sort((a, b) => b.y - a.y || a.x - b.x)

    const leftPage = sortCol(left)
    const rightPage = sortCol(right)
    if (leftPage.length) lines.push(...leftPage.map((b) => b.text))
    if (rightPage.length) lines.push(...rightPage.map((b) => b.text))
  }

  return { text: lines.join("\n"), layout: "double", blocks: usable.length }
}

/**
 * 纯文本双栏启发式：检测「左栏行 + 右栏行」交替穿插的乱序模式并重排。
 * 常见于 naive PDF 提取器按物理坐标扫描导致的交叉文本。
 */
export function reorderInterleavedPlainText(raw: string): ColumnReorderResult {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length < 8) {
    return { text: raw.trim(), layout: "unknown", blocks: lines.length }
  }

  const shortLines = lines.filter((l) => l.length <= 72)
  if (shortLines.length < lines.length * 0.55) {
    return { text: raw.trim(), layout: "single", blocks: lines.length }
  }

  const even: string[] = []
  const odd: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i % 2 === 0) even.push(lines[i]!)
    else odd.push(lines[i]!)
  }

  const evenAvg = even.reduce((s, l) => s + l.length, 0) / Math.max(even.length, 1)
  const oddAvg = odd.reduce((s, l) => s + l.length, 0) / Math.max(odd.length, 1)
  const balance = Math.min(evenAvg, oddAvg) / Math.max(evenAvg, oddAvg)

  if (balance < 0.35) {
    return { text: raw.trim(), layout: "unknown", blocks: lines.length }
  }

  const reordered = [...even, ...odd].join("\n")
  return { text: reordered, layout: "double", blocks: lines.length }
}

export function applyColumnReorder(input: string, blocks?: LayoutTextBlock[]): ColumnReorderResult {
  if (blocks?.length) return reorderDoubleColumnBlocks(blocks)
  return reorderInterleavedPlainText(input)
}
