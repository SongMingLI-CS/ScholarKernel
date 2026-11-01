/** 每百万 Token 的美元单价（input / output） */
export type ModelPricing = { inputPerM: number; outputPerM: number }

const MODEL_PRICING: Record<string, ModelPricing> = {
  "deepseek-r1": { inputPerM: 1, outputPerM: 2 },
  "deepseek-reasoner": { inputPerM: 1, outputPerM: 2 },
  "deepseek-chat": { inputPerM: 0.14, outputPerM: 0.28 },
  "gpt-4o": { inputPerM: 2.5, outputPerM: 10 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.6 },
  "gpt-4.1": { inputPerM: 2, outputPerM: 8 },
  "gpt-4.1-mini": { inputPerM: 0.4, outputPerM: 1.6 },
  "claude-3-5-sonnet": { inputPerM: 3, outputPerM: 15 },
  "claude-sonnet-4": { inputPerM: 3, outputPerM: 15 },
  "gemini-2.0-flash": { inputPerM: 0.1, outputPerM: 0.4 },
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 10 },
  /** Tavily 学术检索：按等效 Token 计费（单次检索约 2k tokens） */
  "tavily-search": { inputPerM: 1, outputPerM: 0 },
  "serper-search": { inputPerM: 1, outputPerM: 0 },
}

const DEFAULT_PRICING: ModelPricing = { inputPerM: 1, outputPerM: 2 }

export const DEFAULT_FREE_TOKEN_QUOTA = 500_000

/**
 * 子串匹配必须「最长模式优先」。
 *
 * 表里同时存在 `gpt-4o` 与 `gpt-4o-mini`、`gpt-4.1` 与 `gpt-4.1-mini`，
 * 若按声明顺序遍历，带日期后缀的真实 model id（`gpt-4o-mini-2024-07-18`）
 * 会先命中更短的全尺寸版本，把 mini 的价格抬高 16.7 倍。
 * 按模式长度降序预排序后，更具体的模式天然先命中。
 */
const PRICING_PATTERNS: ReadonlyArray<readonly [string, ModelPricing]> = Object.entries(
  MODEL_PRICING
).sort((a, b) => b[0].length - a[0].length)

export function normalizeModelKey(modelUsed: string): string {
  return modelUsed.trim().toLowerCase().replace(/^[^/]+\//, "")
}

export function resolveModelPricing(modelUsed: string): ModelPricing {
  const key = normalizeModelKey(modelUsed)
  const exact = Object.prototype.hasOwnProperty.call(MODEL_PRICING, key)
    ? MODEL_PRICING[key]
    : undefined
  if (exact) return exact
  for (const [pattern, pricing] of PRICING_PATTERNS) {
    if (key.includes(pattern)) return pricing
  }
  return DEFAULT_PRICING
}

export function calculateTokenCost(modelUsed: string, inputTokens: number, outputTokens: number): number {
  const pricing = resolveModelPricing(modelUsed)
  const inputCost = (Math.max(0, inputTokens) / 1_000_000) * pricing.inputPerM
  const outputCost = (Math.max(0, outputTokens) / 1_000_000) * pricing.outputPerM
  return Math.round((inputCost + outputCost) * 1e8) / 1e8
}

/** 字符数粗估 Token（Tavily 等无 usage 元数据时使用） */
export function estimateTokensFromText(text: string): number {
  const chars = text.trim().length
  if (chars <= 0) return 0
  return Math.max(1, Math.ceil(chars / 4))
}

/**
 * 直接按字符数估算，不构造等长字符串。
 * 旧实现用 `"x".repeat(resultChars)` 只是为了取长度，大结果集时会白白分配
 * 同等体积的字符串；传入负数或 Infinity 还会抛 RangeError 打断计费。
 */
export function estimateTokensFromCharCount(chars: number): number {
  if (typeof chars !== "number" || !Number.isFinite(chars) || chars <= 0) return 0
  const n = Math.floor(chars)
  if (n <= 0) return 0
  return Math.max(1, Math.ceil(n / 4))
}

const SEARCH_BASE_TOKENS = 2000

/** 单次 Tavily/Serper 检索的等效 Token 消耗 */
export function estimateSearchTokenUsage(query: string, resultChars = 0): number {
  return SEARCH_BASE_TOKENS + estimateTokensFromText(query) + estimateTokensFromCharCount(resultChars)
}
