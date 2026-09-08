const activeRuns = new Map<string, AbortController>()

export function registerActiveAgentRun(jobId: string): AbortSignal {
  activeRuns.get(jobId)?.abort(new DOMException("Superseded", "AbortError"))
  const controller = new AbortController()
  activeRuns.set(jobId, controller)
  return controller.signal
}

export function cancelActiveAgentRun(jobId: string): boolean {
  const controller = activeRuns.get(jobId)
  if (!controller) return false
  controller.abort(new DOMException("Cancelled", "AbortError"))
  return true
}

export function unregisterActiveAgentRun(jobId: string): void {
  activeRuns.delete(jobId)
}
