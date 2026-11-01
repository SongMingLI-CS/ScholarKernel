export type NetworkFailureKind = "cors" | "offline" | "unknown"

/**
 * 浏览器断网时抛的就是 `TypeError: Failed to fetch`，与跨域被拦时的文案逐字相同。
 * 因此 `navigator.onLine === false` 必须**先于**字符串匹配判断：它是唯一可靠的区分依据。
 * 顺序颠倒会让断网用户收到「请检查跨域配置」的帮助弹窗（models-panel / use-chat-send 都走这条路径）。
 */
function isBrowserOffline(): boolean {
  return typeof navigator !== "undefined" && navigator?.onLine === false
}

export function classifyFetchError(e: unknown): { kind: NetworkFailureKind; message: string } {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : "UnknownError"

  if (isBrowserOffline()) return { kind: "offline", message: msg }

  const m = msg.toLowerCase()

  // Chromium / WebKit style
  if (m.includes("failed to fetch")) return { kind: "cors", message: msg }
  if (m.includes("networkerror") && m.includes("fetch")) return { kind: "cors", message: msg }
  if (m.includes("load failed")) return { kind: "cors", message: msg }

  return { kind: "unknown", message: msg }
}

export function isLikelyCorsBlocked(e: unknown) {
  return classifyFetchError(e).kind === "cors"
}
