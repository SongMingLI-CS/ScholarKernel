/** 判断是否为用户/AbortController 主动取消（非业务失败）。 */
export function isAbortError(error: unknown): boolean {
  if (error == null) return false
  if (typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name)
    if (name === "AbortError") return true
  }
  const msg = error instanceof Error ? error.message : String(error)
  return /aborted|abort/i.test(msg)
}
