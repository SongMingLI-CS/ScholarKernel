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

export type PageGeometry = {
  page: number
  width: number
  height?: number
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/** 在 x 坐标分布中寻找最大间隙，作为双栏分界线的备选。 */
function detectColumnSplitByGap(xs: number[]): number | null {
  if (xs.length < 4) return null
  const sorted = [...new Set(xs)].sort((a, b) => a - b)
  if (sorted.length < 2) return null

  let bestGap = 0
  let split = median(xs)
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1]! - sorted[i]!
    if (gap > bestGap) {
      bestGap = gap
      split = (sorted[i]! + sorted[i + 1]!) / 2
    }
  }

  const span = sorted[sorted.length - 1]! - sorted[0]!
  if (span <= 0 || bestGap < span * 0.08) return null
  return split
}

/**
 * 页宽中轴线：优先使用 PDF MediaBox 宽度的一半；
 * 否则在块 x 分布上寻找栏间最大间隙。
 */
export function resolvePageMidline(
  pageBlocks: LayoutTextBlock[],
  pageGeometry?: PageGeometry
): number {
  if (pageGeometry?.width && pageGeometry.width > 0) {
    return pageGeometry.width / 2
  }
  const xs = pageBlocks.map((b) => b.x)
  if (!xs.length) return 0
  return detectColumnSplitByGap(xs) ?? median(xs)
}

function isBalancedDoubleColumn(left: LayoutTextBlock[], right: LayoutTextBlock[]): boolean {
  if (left.length < 2 || right.length < 2) return false
  const ratio = Math.min(left.length, right.length) / Math.max(left.length, right.length)
  return ratio >= 0.25
}

/** 基于页宽中轴线切分左右栏，按页→左栏→右栏阅读顺序拼接。 */
export function reorderDoubleColumnBlocks(
  blocks: LayoutTextBlock[],
  pageGeometries?: PageGeometry[]
): ColumnReorderResult {
  const usable = blocks
    .map((b) => ({ ...b, text: b.text.replace(/\s+/g, " ").trim() }))
    .filter((b) => b.text.length > 0)

  if (usable.length === 0) {
    return { text: "", layout: "unknown", blocks: 0 }
  }

  const geoByPage = new Map<number, PageGeometry>()
  for (const g of pageGeometries ?? []) geoByPage.set(g.page, g)

  const pages = [...new Set(usable.map((b) => b.page))].sort((a, b) => a - b)
  const lines: string[] = []
  let doublePages = 0
  let singlePages = 0

  for (const page of pages) {
    const pageBlocks = usable.filter((b) => b.page === page)
    const midline = resolvePageMidline(pageBlocks, geoByPage.get(page))
    const left = pageBlocks.filter((b) => b.x < midline)
    const right = pageBlocks.filter((b) => b.x >= midline)

    const sortCol = (col: LayoutTextBlock[]) => col.sort((a, b) => b.y - a.y || a.x - b.x)

    if (isBalancedDoubleColumn(left, right)) {
      doublePages += 1
      const leftPage = sortCol(left)
      const rightPage = sortCol(right)
      if (leftPage.length) lines.push(...leftPage.map((b) => b.text))
      if (rightPage.length) lines.push(...rightPage.map((b) => b.text))
    } else {
      singlePages += 1
      const single = sortCol(pageBlocks)
      lines.push(...single.map((b) => b.text))
    }
  }

  const layout: ColumnReorderResult["layout"] =
    doublePages > 0 && singlePages === 0
      ? "double"
      : doublePages > singlePages
        ? "double"
        : doublePages === 0
          ? "single"
          : "double"

  return { text: lines.join("\n"), layout, blocks: usable.length }
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

export function applyColumnReorder(
  input: string,
  blocks?: LayoutTextBlock[],
  pageGeometries?: PageGeometry[]
): ColumnReorderResult {
  if (blocks?.length) return reorderDoubleColumnBlocks(blocks, pageGeometries)
  return reorderInterleavedPlainText(input)
}
