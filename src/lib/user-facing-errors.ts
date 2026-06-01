import type { Lang } from "@/store/useAgentStore"

export type UserFacingError = {
  title: string
  message: string
  actionHint?: string
  openPanel?: "keys" | "models" | "settings" | "chat"
}

type Copy = { zh: UserFacingError; en: UserFacingError }

const COPY = {
  missingApiKey: {
    zh: {
      title: "缺少 API 密钥",
      message: "当前模型需要云端 API Key，但尚未配置或尚未解锁。",
      actionHint: "请打开「密钥 / 隐私」面板，填入对应供应商密钥后重试。",
      openPanel: "keys",
    },
    en: {
      title: "Missing API key",
      message: "The active cloud model requires an API key that is not configured or unlocked.",
      actionHint: "Open Keys / Privacy, add the provider key, then retry.",
      openPanel: "keys",
    },
  },
  missingSearchKey: {
    zh: {
      title: "缺少检索 API 密钥",
      message: "学术检索需要 Tavily 或 Serper API Key。",
      actionHint: "在「密钥 / 隐私」中配置检索密钥，或关闭自动检索。",
      openPanel: "keys",
    },
    en: {
      title: "Missing search API key",
      message: "Academic search requires a Tavily or Serper API key.",
      actionHint: "Configure search keys under Keys / Privacy, or disable auto-search.",
      openPanel: "keys",
    },
  },
  corsBlocked: {
    zh: {
      title: "浏览器跨域被拦截",
      message: "无法从浏览器直接访问模型服务，通常是 CORS 或本地 Ollama 未开放跨域。",
      actionHint: "云端模型请使用内置同源代理；Ollama 请设置 OLLAMA_ORIGINS 或使用向导中的 CORS 说明。",
      openPanel: "models",
    },
    en: {
      title: "Browser CORS blocked",
      message: "The browser cannot reach the model endpoint, often due to CORS or Ollama origin settings.",
      actionHint: "Use the built-in proxy for cloud models, or configure Ollama CORS as described in Setup Guide.",
      openPanel: "models",
    },
  },
  ollamaDown: {
    zh: {
      title: "Ollama 未响应",
      message: "无法连接到本地 Ollama 服务（11434 端口）。",
      actionHint: "请确认已运行 `ollama serve`，并已拉取当前模型。",
      openPanel: "models",
    },
    en: {
      title: "Ollama is not reachable",
      message: "Could not connect to local Ollama on port 11434.",
      actionHint: "Run `ollama serve` and ensure the selected model is pulled.",
      openPanel: "models",
    },
  },
  timeout: {
    zh: {
      title: "请求超时",
      message: "模型或检索服务在限定时间内未返回结果。",
      actionHint: "可尝试缩短问题、切换更快模型，或稍后重试。",
    },
    en: {
      title: "Request timed out",
      message: "The model or search provider did not respond in time.",
      actionHint: "Try a shorter prompt, a faster model, or retry later.",
    },
  },
  aborted: {
    zh: {
      title: "已停止生成",
      message: "你手动停止了本次回复。",
    },
    en: {
      title: "Generation stopped",
      message: "You stopped this response.",
    },
  },
  invalidApiKey: {
    zh: {
      title: "API 密钥无效",
      message: "供应商返回 401/403，说明密钥错误或已失效。",
      actionHint: "请检查「密钥 / 隐私」中的密钥是否正确、是否有余额。",
      openPanel: "keys",
    },
    en: {
      title: "Invalid API key",
      message: "The provider returned 401/403, which usually means the key is wrong or expired.",
      actionHint: "Verify the key under Keys / Privacy and check billing/quota.",
      openPanel: "keys",
    },
  },
  planParseFailed: {
    zh: {
      title: "任务规划解析失败",
      message: "模型返回的规划格式无法解析，工作流未能启动。",
      actionHint: "可点击重试，或切换到更稳定的模型后再试。",
    },
    en: {
      title: "Planning parse failed",
      message: "The model returned a plan that could not be parsed, so the workflow did not start.",
      actionHint: "Retry or switch to a more reliable model.",
    },
  },
  proxyUnauthorized: {
    zh: {
      title: "Proxy 未授权",
      message: "访问同源 LLM 代理被拒绝。",
      actionHint: "若部署者启用了 PROXY_ACCESS_TOKEN，请在设置中配置 Proxy 访问令牌或先登录。",
      openPanel: "settings",
    },
    en: {
      title: "Proxy unauthorized",
      message: "Access to the same-origin LLM proxy was denied.",
      actionHint: "If PROXY_ACCESS_TOKEN is enabled, configure the proxy token in Settings or sign in first.",
      openPanel: "settings",
    },
  },
  generic: {
    zh: {
      title: "请求失败",
      message: "发生未知错误，请查看详情或重试。",
    },
    en: {
      title: "Request failed",
      message: "An unexpected error occurred. Check details or retry.",
    },
  },
} as const satisfies Record<string, Copy>

function pick(copy: Copy, lang: Lang): UserFacingError {
  return copy[lang]
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? "")
}

function includesAny(haystack: string, needles: string[]) {
  const lower = haystack.toLowerCase()
  return needles.some((n) => lower.includes(n.toLowerCase()))
}

export function mapErrorToUserFacing(error: unknown, lang: Lang): UserFacingError {
  const msg = errorText(error)

  if (includesAny(msg, ["MissingApiKey", "MissingApiKeyError"])) return pick(COPY.missingApiKey, lang)
  if (includesAny(msg, ["MissingSearchApiKey"])) return pick(COPY.missingSearchKey, lang)
  if (includesAny(msg, ["Unauthorized proxy", "PROXY_ACCESS_TOKEN"])) return pick(COPY.proxyUnauthorized, lang)
  if (includesAny(msg, ["InvalidApiKey", "401", "403", "Unauthorized"])) return pick(COPY.invalidApiKey, lang)
  if (includesAny(msg, ["ECONNREFUSED", "connect ECONNREFUSED", "Failed to fetch", "NetworkError", "CORS"])) {
    if (includesAny(msg, ["11434", "ollama"])) return pick(COPY.ollamaDown, lang)
    return pick(COPY.corsBlocked, lang)
  }
  if (includesAny(msg, ["timeout", "aborted", "AbortError", "ETIMEDOUT"])) {
    if (includesAny(msg, ["abort"])) return pick(COPY.aborted, lang)
    return pick(COPY.timeout, lang)
  }
  if (includesAny(msg, ["WorkflowPlanParseError", "InvalidJSON", "ZodError", "TaskListSchema"])) {
    return pick(COPY.planParseFailed, lang)
  }

  const generic = pick(COPY.generic, lang)
  return { ...generic, message: `${generic.message}\n\n详情：${msg}` }
}

export function formatUserFacingErrorMessage(error: unknown, lang: Lang): string {
  const mapped = mapErrorToUserFacing(error, lang)
  const lines = [`⚠️ ${mapped.title}`, mapped.message]
  if (mapped.actionHint) lines.push(`建议：${mapped.actionHint}`)
  return lines.join("\n\n")
}
