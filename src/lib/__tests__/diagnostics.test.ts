import { expect, it, vi } from "vitest"
import { logDiagnosticError } from "@/lib/diagnostics"

it("records structured failure metadata", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => {})
  logDiagnosticError("fixture.failed", Object.assign(new Error("fixture details"), { code: "ETIMEDOUT", statusCode: 504 }))
  expect(output).toHaveBeenCalledExactlyOnceWith("fixture.failed", { name: "Error", code: "ETIMEDOUT", status: 504 })
})
