import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { CANVAS_EDITOR_PROSE_CLASS, CANVAS_EDITOR_ROOT_CLASS } from "@/lib/canvas-prose"

describe("canvas-prose", () => {
  it("exports prose-invert academic editor classes for TipTap", () => {
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("prose")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("prose-invert")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("sk-canvas-prose")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("break-words")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("antialiased")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("leading-7")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("prose-th:border-0")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("max-w-none")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("prose-th:px-4")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("prose-th:py-2.5")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("prose-th:tabular-nums")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("prose-table:border-t-2")
    expect(CANVAS_EDITOR_PROSE_CLASS).toContain("prose-table:border-b-2")
  })

  it("root wrapper uses sk-canvas-editor for scoped typography CSS", () => {
    expect(CANVAS_EDITOR_ROOT_CLASS).toBe("sk-canvas-editor")
  })

  it("globals.css defines academic heading borders and three-line tables", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
    expect(css).toContain(".sk-canvas-prose h1")
    expect(css).toContain(".sk-canvas-prose h2")
    expect(css).toContain(".sk-canvas-prose table")
    expect(css).toMatch(/border-top.*2px|2px.*solid/)
    expect(css).toContain("border-left: none")
    expect(css).toContain("font-variant-numeric: tabular-nums")
    expect(css).toContain("table:not(:has(thead))")
    expect(css).toContain(".sk-canvas-prose .katex-display")
    expect(css).toContain(".sk-split-pane")
    expect(css).toContain("sk-canvas-artifact-cta")
  })
})
