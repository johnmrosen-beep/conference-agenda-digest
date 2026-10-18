// Turns the scattered pieces of text that pdf.js finds on each page into clean page text
// that Claude can read. Nothing in this file touches the PDF library, so every rule here
// can be unit-tested with small made-up examples (see tests/cleanText.test.ts).
//
// The rules, in order:
// 1. Drop text drawn at an angle (watermarks running up the page margin).
// 2. Rebuild lines from pieces that share a baseline, marking small raised digits as
//    superscripts: "Hassan⁵" becomes "Hassan^5" instead of the misleading "Hassan5".
// 3. Rejoin words split across lines with a hyphen ("Hos-" + "pital" -> "Hospital").
// 4. Remove running headers and footers that repeat at the top or bottom of many pages,
//    keeping the first copy so nothing is lost entirely.

/** One piece of text as pdf.js reports it, reduced to what we use. */
export interface RawTextItem {
  str: string
  /** Left edge and baseline, in PDF points (y grows upward). */
  x: number
  y: number
  /** Font size in points. */
  size: number
  /** Width in points. */
  width: number
  /** pdf.js says a line break follows this piece. */
  hasEOL: boolean
  /** Drawn at an angle, like a watermark running up the margin. */
  rotated: boolean
}

export interface RawPage {
  pageNumber: number
  items: RawTextItem[]
}

/** The fields of a pdf.js text item that fromPdfJsItem reads. */
export interface PdfJsTextItemLike {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL: boolean
}

export interface CleanPage {
  pageNumber: number
  text: string
}

export interface RemovedLine {
  /** The first copy, which was kept. */
  example: string
  /** How many copies were removed. */
  removedCount: number
}

export interface CleanDocument {
  pages: CleanPage[]
  removedLines: RemovedLine[]
  rotatedItemsDropped: number
  /** Pages with no readable text at all (often scanned images). */
  emptyPages: number[]
}

// pdf.js describes each piece's position with a matrix [a, b, c, d, x, y]. For ordinary
// upright text b is 0; a non-zero b means the text is rotated.
export function fromPdfJsItem(item: PdfJsTextItemLike): RawTextItem {
  const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform
  const size = Math.hypot(c, d) || item.height
  return {
    str: item.str,
    x,
    y,
    size,
    width: item.width,
    hasEOL: item.hasEOL,
    rotated: Math.abs(b) > 0.05 * Math.hypot(a, b),
  }
}

// Text that can be an affiliation or footnote marker: digits, commas, * and dagger signs.
const MARKER_TEXT = /^[\d\s,*†‡§¶]*[\d*†‡§¶][\d\s,*†‡§¶]*$/

interface Part {
  text: string
  x: number
  endX: number
  superscript: boolean
}

interface Line {
  y: number
  size: number
  parts: Part[]
  /** True while the line holds only small marker text, like a leading "¹". */
  onlyMarkers: boolean
}

function tidy(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u00ad\u200b-\u200d\ufeff]/g, '') // soft hyphens and invisible characters
    .replace(/[\s\u00a0]+/g, ' ')
}

function renderLine(line: Line): string {
  let out = ''
  let prev: Part | null = null
  for (const part of line.parts) {
    const text = part.superscript ? `^${part.text.replace(/\s+/g, '')}` : tidy(part.text)
    if (prev && out && !/\s$/.test(out) && !/^\s/.test(text) && !part.superscript) {
      const gap = part.x - prev.endX
      if (gap > 3 * line.size) out += '  ' // a wide gap, usually a column break
      else if (gap > 0.2 * line.size || gap < -line.size) out += ' '
    }
    out += text
    prev = part
  }
  // Some PDFs draw a dash with a glyph that has no text meaning, which comes out as the
  // "unknown character" sign. Between spaces it is almost always a dash.
  return out.replace(/ {3,}/g, '  ').replace(/ � /g, ' – ').trim()
}

/** Rebuilds the lines of one page from its text pieces, in the order the PDF stores them. */
export function buildLines(items: RawTextItem[]): { lines: string[]; rotatedDropped: number } {
  const lines: string[] = []
  let rotatedDropped = 0
  let line: Line | null = null

  const finish = () => {
    if (line) {
      const text = renderLine(line)
      if (text) lines.push(text)
    }
    line = null
  }

  for (const item of items) {
    if (item.rotated) {
      if (item.str.trim()) rotatedDropped++
      continue
    }
    if (item.str === '') {
      // pdf.js sends empty pieces just to mark the end of a line.
      if (item.hasEOL) finish()
      continue
    }

    const current: Line | null = line
    // The type is written out because TypeScript otherwise goes in a circle: `size` comes from
    // `line`, and `line` is later rebuilt from `size`.
    const size: number = item.size > 0 ? item.size : (current?.size ?? 10)
    const isMarker = MARKER_TEXT.test(item.str)
    const part: Part = { text: item.str, x: item.x, endX: item.x + item.width, superscript: false }

    if (!current) {
      line = { y: item.y, size, parts: [part], onlyMarkers: isMarker }
    } else {
      const rise = item.y - current.y
      if (
        isMarker &&
        size < 0.85 * current.size &&
        rise > 0.15 * current.size &&
        rise < 0.9 * current.size
      ) {
        // Smaller digits sitting above the baseline: a superscript, like the 5 in "Hassan⁵".
        part.superscript = true
        current.parts.push(part)
      } else if (
        current.onlyMarkers &&
        size > 1.15 * current.size &&
        -rise > 0.15 * size &&
        -rise < 0.9 * size
      ) {
        // The line so far was only small raised digits, and now the full-size text arrives
        // just below them: those digits were a leading superscript, as in "¹Pediatrics".
        for (const earlier of current.parts) earlier.superscript = earlier.text.trim() !== ''
        current.y = item.y
        current.size = size
        current.onlyMarkers = false
        current.parts.push(part)
      } else if (Math.abs(rise) <= 0.35 * Math.max(current.size, size)) {
        current.parts.push(part)
        if (!isMarker) current.onlyMarkers = false
      } else {
        finish()
        line = { y: item.y, size, parts: [part], onlyMarkers: isMarker }
      }
    }

    if (item.hasEOL) finish()
  }
  finish()
  return { lines, rotatedDropped }
}

/** Rejoins a lowercase word that was split across two lines with a hyphen. */
export function joinHyphenated(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const last = out.length - 1
    if (last >= 0 && /[a-z]-$/.test(out[last]!) && /^[a-z]/.test(line)) {
      out[last] = out[last]!.slice(0, -1) + line
    } else {
      out.push(line)
    }
  }
  return out
}

// How many lines at the top and bottom of a page count as header or footer.
const EDGE_LINES = 3
// Never remove lines that carry schedule information, even if they repeat, because a
// session's day or time matters more than tidiness.
const SCHEDULE_WORDS =
  /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? +\d|\bmay +\d|\d{1,2}:\d{2}/i

function lineKey(line: string): string {
  return line.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}

function edgeIndexes(count: number): Set<number> {
  const indexes = new Set<number>()
  for (let i = 0; i < Math.min(EDGE_LINES, count); i++) {
    indexes.add(i)
    indexes.add(count - 1 - i)
  }
  return indexes
}

/**
 * Removes lines that repeat at the top or bottom of many pages (running headers, footers,
 * download watermarks). Page numbers are folded together, so "Page 12" and "Page 13" count
 * as the same line. The first copy is always kept.
 */
export function removeRepeatedEdgeLines(pages: string[][]): {
  pages: string[][]
  removed: RemovedLine[]
} {
  const pagesPerKey = new Map<string, number>()
  const exampleForKey = new Map<string, string>()
  for (const lines of pages) {
    const keysOnPage = new Set<string>()
    for (const i of edgeIndexes(lines.length)) {
      const key = lineKey(lines[i]!)
      keysOnPage.add(key)
      if (!exampleForKey.has(key)) exampleForKey.set(key, lines[i]!)
    }
    for (const key of keysOnPage) pagesPerKey.set(key, (pagesPerKey.get(key) ?? 0) + 1)
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.3))
  const repeated = new Set<string>()
  for (const [key, count] of pagesPerKey) {
    const letters = key.replace(/[^a-z]/g, '').length
    if (count >= threshold && letters >= 3 && !SCHEDULE_WORDS.test(exampleForKey.get(key)!)) {
      repeated.add(key)
    }
  }

  const kept = new Set<string>()
  const removedCount = new Map<string, number>()
  const cleaned = pages.map((lines) => {
    const edges = edgeIndexes(lines.length)
    return lines.filter((line, i) => {
      const key = lineKey(line)
      if (!edges.has(i) || !repeated.has(key)) return true
      if (!kept.has(key)) {
        kept.add(key)
        return true
      }
      removedCount.set(key, (removedCount.get(key) ?? 0) + 1)
      return false
    })
  })

  const removed = [...removedCount].map(([key, count]) => ({
    example: exampleForKey.get(key)!,
    removedCount: count,
  }))
  return { pages: cleaned, removed }
}

/** Runs every cleaning rule over the whole document. */
export function cleanDocument(rawPages: RawPage[]): CleanDocument {
  let rotatedItemsDropped = 0
  const pageLines = rawPages.map((page) => {
    const { lines, rotatedDropped } = buildLines(page.items)
    rotatedItemsDropped += rotatedDropped
    return joinHyphenated(lines)
  })

  const { pages: cleaned, removed } = removeRepeatedEdgeLines(pageLines)

  const pages = rawPages.map((page, i) => ({
    pageNumber: page.pageNumber,
    text: cleaned[i]!.join('\n'),
  }))
  return {
    pages,
    removedLines: removed,
    rotatedItemsDropped,
    emptyPages: pages.filter((p) => p.text === '').map((p) => p.pageNumber),
  }
}

/** The text Claude will receive: every page, each labeled so answers can cite page numbers. */
export function toPromptText(pages: CleanPage[]): string {
  return pages.map((p) => `=== PAGE ${p.pageNumber} ===\n${p.text}`).join('\n\n')
}

/**
 * A rough token count: about 4 characters of English per token. Good enough for a size
 * estimate; the exact count comes from Claude's token-counting endpoint before any paid run.
 */
export function roughTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}
