export type NetworkFailureKind = "cors" | "offline" | "unknown"

export function classifyFetchError(e: unknown): { kind: NetworkFailureKind; message: string } {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "string"
        ? e
        : "UnknownError"

  const m = msg.toLowerCase()

  // Chromium / WebKit style
  if (m.includes("failed to fetch")) return { kind: "cors", message: msg }
  if (m.includes("networkerror") && m.includes("fetch")) return { kind: "cors", message: msg }
  if (m.includes("load failed")) return { kind: "cors", message: msg }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { kind: "offline", message: msg }
  }

  return { kind: "unknown", message: msg }
}

export function isLikelyCorsBlocked(e: unknown) {
  return classifyFetchError(e).kind === "cors"
}
