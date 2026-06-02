import { cn } from "@/lib/utils"

/** Wrapper on CanvasEditor root — pairs with `.sk-canvas-prose` rules in globals.css. */
export const CANVAS_EDITOR_ROOT_CLASS = "sk-canvas-editor"

/** TipTap ProseMirror surface: Tailwind Typography + academic overrides. */
export const CANVAS_EDITOR_PROSE_CLASS = cn(
  "sk-canvas-prose prose prose-invert max-w-none min-h-[320px] w-full break-words antialiased focus:outline-none",
  "prose-p:leading-7 prose-p:my-3 prose-li:leading-7",
  "prose-table:w-full prose-table:border-collapse prose-table:border-t-2 prose-table:border-t-gray-400/80 prose-table:border-b-2 prose-table:border-b-gray-400/80",
  "prose-th:border-0 prose-th:border-x-0 prose-th:border-b prose-th:border-gray-500/50 prose-th:px-4 prose-th:py-2.5 prose-th:tabular-nums",
  "prose-td:border-0 prose-td:border-x-0 prose-td:px-4 prose-td:py-2.5 prose-td:tabular-nums",
  "prose-thead:border-b prose-thead:border-gray-500/50",
  "prose-headings:font-semibold prose-headings:tracking-tight",
  "prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
  "prose-a:text-emerald-300/90 prose-a:no-underline hover:prose-a:underline",
  "prose-blockquote:border-l-emerald-500/40 prose-blockquote:text-muted-foreground",
  "prose-code:before:content-none prose-code:after:content-none",
  "prose-pre:overflow-x-auto"
)
