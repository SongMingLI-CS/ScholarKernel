/** Consolidate bibliographies without changing inline citation numbers or code examples. */
export function normalizeReferenceSections(markdown: string, fallback = ""): string {
  const lines = markdown.split("\n")
  const body: string[] = []
  const entries: string[] = []
  let fence = ""
  let canvas = false
  let sectionLevel = 0
  let found = false
  let entry = ""
  const flush = () => {
    if (entry.trim()) entries.push(entry.trim())
    entry = ""
  }
  for (const line of lines) {
    const trimmed = line.trim()
    const marker = trimmed.match(/^(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ""
      if (sectionLevel) { flush(); sectionLevel = 0 }
      body.push(line)
      continue
    }
    if (fence) { body.push(line); continue }
    if (/<scholar-canvas\b/.test(line)) canvas = true
    if (canvas) {
      body.push(line)
      if (/<\/scholar-canvas>/.test(line)) canvas = false
      continue
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    const referenceHeading = heading && /^(?:\d+[.、]?\s*)?(?:参考文献(?:\s*[（(]References[）)])?|References|Bibliography)$/i.test(heading[2])
    if (referenceHeading) {
      flush()
      found = true
      sectionLevel = heading[1].length
      continue
    }
    if (sectionLevel && heading && heading[1].length <= sectionLevel) {
      flush()
      sectionLevel = 0
    }
    if (!sectionLevel) { body.push(line); continue }
    if (!trimmed || /^---+$/.test(trimmed)) { flush(); continue }
    const start = trimmed.replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "")
    if (/^\[\d+\]/.test(start) || /^[-*+]\s+|^\d+[.)]\s+/.test(trimmed)) {
      flush()
      entry = start
    } else {
      entry += (entry ? "\n  " : "") + trimmed
    }
  }
  flush()
  if (!found) {
    // A full canvas report already owns its bibliography; do not repeat it outside the card.
    if (!fallback || /<scholar-canvas\b[\s\S]*?^#{1,6}\s+(?:\d+\s+)?(?:参考文献|References|Bibliography)/im.test(markdown)) return markdown
    return normalizeReferenceSections(`${markdown.trimEnd()}\n\n${fallback}`)
  }
  if (!entries.length) return markdown
  const seen = new Set<string>()
  const unique = entries.filter((item) => {
    const key = item.replace(/\s+/g, " ").trim()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return `${body.join("\n").trimEnd()}${body.some((line) => line.trim()) ? "\n\n" : ""}## 参考文献 (References)\n\n${unique.map((item) => `- ${item}`).join("\n\n")}`
}
