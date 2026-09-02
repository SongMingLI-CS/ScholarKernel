import { beforeEach, describe, expect, it } from "vitest"

import { injectPageCitationAnchors, pageCitationToHtml, segmentPageCitations } from "@/lib/page-citation"
import { markdownToCanvasHtml } from "@/lib/markdown-bridge"
import { useAgentStore } from "@/store/useAgentStore"

describe("pdf-co-reader citation anchoring", () => {
  beforeEach(() => {
    useAgentStore.setState({
      canvas: { activeDocument: null, canvasOpen: false },
      pdfCoReader: {
        viewMode: "canvas",
        sessionPdfUrl: null,
        sessionPdfName: null,
        targetPage: null,
        scrollNonce: 0,
      },
    })
  })

  it("parses standard [Page 7] and mis-spaced [page  7] into citation segments", () => {
    const text = "See [Page 7] and also [page  7] for details."
    const segments = segmentPageCitations(text)
    const citations = segments.filter((s) => s.kind === "citation")
    expect(citations).toHaveLength(2)
    expect(citations[0]).toMatchObject({ kind: "citation", page: 7, content: "[Page 7]" })
    expect(citations[1]).toMatchObject({ kind: "citation", page: 7 })
  })

  it("transforms [p.4] and [Page 4] into HTML spans with data-page attributes", () => {
    const md = "Evidence from [p.4] and [Page 4] supports the claim."
    const html = injectPageCitationAnchors(md)
    expect(html).toContain('data-page="4"')
    expect(html).toContain('data-sk-citation="page"')
    expect(html).toContain("sk-page-citation")
    expect((html.match(/data-page="4"/g) ?? []).length).toBe(2)
  })

  it("embeds citation anchors in canvas markdown HTML pipeline", () => {
    const out = markdownToCanvasHtml("Refer to [Page 3] in the appendix.")
    expect(out).toContain('data-page="3"')
    expect(out).toContain("[Page 3]")
  })

  it("pageCitationToHtml emits accessible interactive anchor markup", () => {
    const el = pageCitationToHtml(12, "[Page 12]")
    expect(el).toContain('data-page="12"')
    expect(el).toContain('role="button"')
    expect(el).toContain("border-amber-500")
  })
})

describe("pdf-co-reader store scrollToPdfPage", () => {
  beforeEach(() => {
    useAgentStore.setState({
      canvas: { activeDocument: null, canvasOpen: false },
      pdfCoReader: {
        viewMode: "canvas",
        sessionPdfUrl: "blob:mock-pdf",
        sessionPdfName: "paper.pdf",
        targetPage: null,
        scrollNonce: 0,
      },
    })
  })

  it("dispatches target page and opens PDF co-reader view", () => {
    useAgentStore.getState().actions.scrollToPdfPage(7)

    const st = useAgentStore.getState()
    expect(st.pdfCoReader.targetPage).toBe(7)
    expect(st.pdfCoReader.viewMode).toBe("pdf")
    expect(st.canvas.canvasOpen).toBe(true)
    expect(st.pdfCoReader.scrollNonce).toBeGreaterThan(0)
  })

  it("clamps invalid page numbers to at least 1", () => {
    useAgentStore.getState().actions.scrollToPdfPage(0)
    expect(useAgentStore.getState().pdfCoReader.targetPage).toBe(1)

    useAgentStore.getState().actions.scrollToPdfPage(-3)
    expect(useAgentStore.getState().pdfCoReader.targetPage).toBe(1)
  })

  it("simulates citation click handler publishing page via scrollToPdfPage", () => {
    const page = 4
    const anchorHtml = pageCitationToHtml(page, "[Page 4]")
    const match = anchorHtml.match(/data-page="(\d+)"/)
    expect(match?.[1]).toBe("4")

    const clickedPage = Number.parseInt(match![1]!, 10)
    useAgentStore.getState().actions.scrollToPdfPage(clickedPage)

    expect(useAgentStore.getState().pdfCoReader.targetPage).toBe(4)
    expect(useAgentStore.getState().pdfCoReader.viewMode).toBe("pdf")
  })
})
