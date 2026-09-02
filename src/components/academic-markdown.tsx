"use client"

import { Check, Copy } from "lucide-react"
import { Component, memo, useCallback, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import type { Components } from "react-markdown"
import type { PluggableList } from "unified"

import { CitationAnchor } from "@/components/CitationAnchor"
import { segmentPageCitations } from "@/lib/page-citation"
import { cn } from "@/lib/utils"

import "katex/dist/katex.min.css"
import "highlight.js/styles/github-dark.css"

/** 将任意值安全转为 Markdown 字符串，避免 React 直接渲染对象导致崩溃 */
export function safeMarkdownContent(raw: unknown): string {
  if (typeof raw === "string") return raw
  if (raw == null) return ""
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw)
  try {
    return `\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\``
  } catch {
    return String(raw)
  }
}

function isReferencesHeading(children: ReactNode): boolean {
  const text = String(children ?? "")
  return /参考文献|references/i.test(text)
}

const CodeBlockWithCopy = memo(function CodeBlockWithCopy({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLPreElement>) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  const onCopy = useCallback(async () => {
    const text = preRef.current?.textContent ?? ""
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore clipboard failures */
    }
  }, [])

  return (
    <div className="group relative my-2">
      <button
        type="button"
        onClick={onCopy}
        className={cn(
          "absolute right-2 top-2 z-10 inline-flex h-7 items-center gap-1 rounded-sm border border-border/60",
          "bg-zinc-900/90 px-2 font-mono text-[10px] text-muted-foreground opacity-0 transition-opacity",
          "hover:border-emerald-500/35 hover:text-emerald-200 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        )}
        aria-label="复制代码"
      >
        {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre
        ref={preRef}
        className={cn(
          "overflow-x-auto whitespace-pre rounded-md border border-border/60 bg-[#0d1117] p-3 pr-16 text-[12px] leading-6",
          "[&_.hljs]:bg-transparent",
          className
        )}
        {...props}
      >
        {children}
      </pre>
    </div>
  )
})

class MarkdownRenderErrorBoundary extends Component<
  { children: ReactNode; fallbackPrefix?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e : new Error(String(e)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[AcademicMarkdown] render failed", error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-sm border border-rose-500/30 bg-rose-500/10 px-3 py-2 font-mono text-[12px] leading-relaxed text-rose-100/95">
          {this.props.fallbackPrefix ?? "内容渲染失败"}：{this.state.error.message}
        </div>
      )
    }
    return this.props.children
  }
}

const components: Components = {
  h1: ({ className, ...props }) => (
    <h1 className={cn("mb-2 mt-4 text-lg font-semibold tracking-wide text-foreground", className)} {...props} />
  ),
  h2: ({ className, children, ...props }) => (
    <h2
      className={cn(
        "mb-2 mt-4 text-base font-semibold tracking-wide text-foreground",
        isReferencesHeading(children) &&
          "border-t border-sidebar-primary/25 pt-3 font-mono text-[13px] uppercase tracking-widest text-sidebar-primary/90",
        className
      )}
      {...props}
    >
      {children}
    </h2>
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mb-2 mt-4 text-sm font-semibold text-foreground", className)} {...props} />
  ),
  p: ({ className, ...props }) => <p className={cn("my-2 leading-7 text-foreground/95", className)} {...props} />,
  a: ({ className, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "break-all text-sky-400/90 underline decoration-sky-500/30 underline-offset-2 transition-colors hover:text-sky-300 hover:decoration-sky-400/60",
        className
      )}
    />
  ),
  ul: ({ className, ...props }) => <ul className={cn("my-2 list-disc pl-5 leading-7 text-foreground/95", className)} {...props} />,
  ol: ({ className, ...props }) => (
    <ol className={cn("my-2 list-decimal pl-5 leading-7 text-foreground/95", className)} {...props} />
  ),
  li: ({ className, ...props }) => <li className={cn("my-0.5 leading-7 marker:text-muted-foreground", className)} {...props} />,
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn(
        "my-2 rounded-md border-l-2 border-sidebar-primary/50 bg-muted/15 px-3 py-2 italic leading-7 text-muted-foreground",
        className
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-2 w-full overflow-x-auto select-text rounded-sm border border-gray-600/80 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.04)]">
      <table className={cn("w-full border-collapse text-left text-[13px]", className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }) => <thead className={cn("bg-gray-800/80", className)} {...props} />,
  tbody: ({ className, ...props }) => (
    <tbody className={cn("[&>tr:nth-child(even)]:bg-muted/10", className)} {...props} />
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn(
        "border border-gray-600 bg-gray-800/90 px-2.5 py-2 text-left font-semibold text-foreground/95",
        className
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border border-gray-700 px-2.5 py-2 text-foreground/90", className)} {...props} />
  ),
  tr: ({ className, ...props }) => <tr className={cn("transition-colors hover:bg-muted/15", className)} {...props} />,
  hr: ({ className, ...props }) => <hr className={cn("my-3 border-border/50", className)} {...props} />,
  pre: CodeBlockWithCopy,
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === "string" && /\blanguage-[\w-]+\b/.test(className)
    if (isBlock) {
      return (
        <code className={cn("block whitespace-pre font-mono text-[12px]", className)} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code
        className={cn(
          "rounded-sm border border-border/60 bg-muted/30 px-1 py-0.5 font-mono text-[12px] text-emerald-200/90",
          className
        )}
        {...props}
      >
        {children}
      </code>
    )
  },
}

function isInlineMarkdownSegment(text: string): boolean {
  return (
    !/^#{1,6}\s/m.test(text) &&
    !/```/.test(text) &&
    !/^\s*[-*+]\s/m.test(text) &&
    !/^\s*\d+\.\s/m.test(text) &&
    !text.includes("\n\n")
  )
}

const MarkdownChunk = memo(function MarkdownChunk({
  content,
  inline,
}: {
  content: string
  inline?: boolean
}) {
  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], [])
  const rehypePlugins = useMemo(
    () => [rehypeKatex, [rehypeHighlight, { detect: true, ignoreMissing: true }]] as PluggableList,
    []
  )
  const chunkComponents = useMemo(
    () =>
      inline
        ? ({
            ...components,
            p: ({ children }) => <span className="inline">{children}</span>,
          } as Components)
        : components,
    [inline]
  )

  if (!content) return null

  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={chunkComponents}>
      {content}
    </ReactMarkdown>
  )
})

export const AcademicMarkdown = memo(function AcademicMarkdown({
  content,
  className,
  fallbackPrefix,
}: {
  content: string
  className?: string
  fallbackPrefix?: string
}) {
  const safeContent = useMemo(() => safeMarkdownContent(content), [content])
  const segments = useMemo(() => segmentPageCitations(safeContent), [safeContent])

  return (
    <MarkdownRenderErrorBoundary fallbackPrefix={fallbackPrefix}>
      <div
        className={cn(
          "sk-md-root prose prose-sm dark:prose-invert max-w-none break-words",
          "prose-p:leading-7 prose-p:my-2",
          "prose-headings:mt-4 prose-headings:mb-2 prose-headings:font-semibold",
          "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:leading-7 prose-hr:my-3",
          "prose-table:w-full prose-table:border-collapse",
          "prose-th:border prose-th:border-gray-600 prose-th:bg-gray-800 prose-th:p-2",
          "prose-td:border prose-td:border-gray-700 prose-td:p-2",
          "prose-li:marker:text-muted-foreground prose-code:before:content-none prose-code:after:content-none",
          className
        )}
      >
        {segments.map((seg, i) =>
          seg.kind === "citation" ? (
            <CitationAnchor key={`cite-${i}-${seg.page}`} page={seg.page} label={seg.content} />
          ) : (
            <MarkdownChunk
              key={`md-${i}`}
              content={seg.content}
              inline={isInlineMarkdownSegment(seg.content)}
            />
          )
        )}
      </div>
    </MarkdownRenderErrorBoundary>
  )
})
