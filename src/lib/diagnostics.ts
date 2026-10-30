/** Operational diagnostics intentionally omit payloads, provider bodies and user text. */
export function logDiagnosticError(event: string, error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {}
  console.error(event, {
    name: error instanceof Error ? error.name : "Error",
    code: typeof record.code === "string" && /^[A-Z0-9_]{1,40}$/.test(record.code) ? record.code : undefined,
    status: typeof record.statusCode === "number" ? record.statusCode : undefined,
  })
}
