import { describe, expect, it } from 'vitest'
import {
  buildLines,
  cleanDocument,
  fromPdfJsItem,
  joinHyphenated,
  removeRepeatedEdgeLines,
  toPromptText,
  type RawTextItem,
} from '../src/lib/pdf/cleanText'

// Builds a made-up text piece the way pdf.js would report it. Width is estimated from the
// number of characters, which is close enough for spacing rules.
function piece(
  str: string,
  x: number,
  y: number,
  options: { size?: number; hasEOL?: boolean; rotated?: boolean } = {},
): RawTextItem {
  const size = options.size ?? 10
  return {
    str,
    x,
    y,
    size,
    width: str.length * size * 0.5,
    hasEOL: options.hasEOL ?? false,
    rotated: options.rotated ?? false,
  }
}

// Places pieces one after another on a line, with a normal word gap between them.
function after(previous: RawTextItem, gap = 3): number {
  return previous.x + previous.width + gap
}

describe('fromPdfJsItem', () => {
  it('reads position and size from the pdf.js matrix', () => {
    const item = fromPdfJsItem({ str: 'Hi', transform: [12, 0, 0, 12, 72, 700], width: 10, height: 12, hasEOL: false })
    expect(item).toMatchObject({ x: 72, y: 700, size: 12, rotated: false })
  })

  it('flags text turned sideways, like a margin watermark', () => {
    const item = fromPdfJsItem({ str: 'Downloaded', transform: [0, 8, -8, 0, 580, 100], width: 40, height: 8, hasEOL: false })
    expect(item.rotated).toBe(true)
  })
})

describe('buildLines', () => {
  it('joins pieces on the same baseline and splits different baselines', () => {
    const a = piece('Plenary', 72, 700)
    const b = piece('Session', after(a), 700)
    const c = piece('Friday, October 23', 72, 686)
    expect(buildLines([a, b, c]).lines).toEqual(['Plenary Session', 'Friday, October 23'])
  })

  it('marks small raised digits after a name as a superscript', () => {
    const name = piece('Ahmad Hassan', 72, 700)
    const mark = piece('5', after(name, 0), 703.5, { size: 6 })
    const rest = piece(', Sahel Basharat', after(mark, 0), 700)
    expect(buildLines([name, mark, rest]).lines).toEqual(['Ahmad Hassan^5, Sahel Basharat'])
  })

  it('keeps comma-separated markers together', () => {
    const name = piece('Kimberly Dawes', 72, 700)
    const mark = piece('1,2', after(name, 0), 703.5, { size: 6 })
    expect(buildLines([name, mark]).lines).toEqual(['Kimberly Dawes^1,2'])
  })

  it('recognizes a superscript at the start of a line', () => {
    const mark = piece('1', 72, 703.5, { size: 6 })
    const text = piece('Pediatrics, University at Buffalo', after(mark, 0), 700)
    expect(buildLines([mark, text]).lines).toEqual(['^1Pediatrics, University at Buffalo'])
  })

  it('leaves full-size numbers alone, such as an abstract number', () => {
    const number = piece('611', 72, 700)
    const title = piece('VALIDATION OF THE BRISTOL STOOL FORM SCALE', after(number), 700)
    expect(buildLines([number, title]).lines).toEqual(['611 VALIDATION OF THE BRISTOL STOOL FORM SCALE'])
  })

  it('ends a line where pdf.js reports a line break', () => {
    const a = piece('First', 72, 700, { hasEOL: true })
    const b = piece('Second', after(a), 700)
    expect(buildLines([a, b]).lines).toEqual(['First', 'Second'])
  })

  it('marks a wide gap between columns with two spaces', () => {
    const left = piece('Abbott', 72, 700)
    const right = piece('Kate Farms', 300, 700)
    expect(buildLines([left, right]).lines).toEqual(['Abbott  Kate Farms'])
  })

  it('drops rotated text and counts it', () => {
    const watermark = piece('Downloaded from example.org', 580, 100, { rotated: true })
    const body = piece('Poster Session I', 72, 700)
    expect(buildLines([watermark, body])).toEqual({ lines: ['Poster Session I'], rotatedDropped: 1 })
  })

  it('turns an unreadable dash glyph between words back into a dash', () => {
    expect(buildLines([piece('Marriott Ballroom 9 \ufffd Lobby Level', 72, 700)]).lines).toEqual([
      'Marriott Ballroom 9 \u2013 Lobby Level',
    ])
  })

  it('keeps accented characters intact', () => {
    expect(buildLines([piece('León, Guanajuato', 72, 700)]).lines).toEqual(['León, Guanajuato'])
  })
})

describe('joinHyphenated', () => {
  it('rejoins a lowercase word split across lines', () => {
    expect(joinHyphenated(['Texas Children’s Hos-', 'pital, Houston, TX'])).toEqual([
      'Texas Children’s Hospital, Houston, TX',
    ])
  })

  it('leaves capitalized titles and numbers alone', () => {
    const lines = ['MASSIVE WALLED-OFF NECROSIS FOLLOWING ASPARAGINASE-', 'ASSOCIATED PANCREATITIS']
    expect(joinHyphenated(lines)).toEqual(lines)
    expect(joinHyphenated(['during COVID-', '19 lockdowns'])).toEqual(['during COVID-', '19 lockdowns'])
  })
})

describe('removeRepeatedEdgeLines', () => {
  const pages = Array.from({ length: 10 }, (_, i) => [
    `Downloaded from example.org on 17/10/2026, page ${i + 1}`,
    'Friday, October 23, 2026',
    `Body text that is unique to page ${'abcdefghij'[i]}`,
    `Page ${i + 1}`,
  ])

  it('keeps the first copy of a repeating header or footer and removes the rest', () => {
    const { pages: cleaned, removed } = removeRepeatedEdgeLines(pages)
    expect(cleaned[0]).toContain('Downloaded from example.org on 17/10/2026, page 1')
    expect(cleaned[0]).toContain('Page 1')
    expect(cleaned[5]).not.toContain('Downloaded from example.org on 17/10/2026, page 6')
    expect(cleaned[5]).not.toContain('Page 6')
    expect(removed).toHaveLength(2)
    expect(removed.every((r) => r.removedCount === 9)).toBe(true)
  })

  it('never removes repeating dates or times, since they carry the schedule', () => {
    const { pages: cleaned } = removeRepeatedEdgeLines(pages)
    expect(cleaned.every((lines) => lines.includes('Friday, October 23, 2026'))).toBe(true)
  })

  it('keeps unique body text', () => {
    const { pages: cleaned } = removeRepeatedEdgeLines(pages)
    expect(cleaned[3]).toContain('Body text that is unique to page d')
  })

  it('removes nothing from very short documents', () => {
    const short = [['Header', 'One'], ['Header', 'Two']]
    expect(removeRepeatedEdgeLines(short).pages).toEqual(short)
  })
})

describe('cleanDocument and toPromptText', () => {
  it('labels each page and reports empty pages', () => {
    const doc = cleanDocument([
      { pageNumber: 1, items: [piece('2026 Annual Meeting', 72, 700)] },
      { pageNumber: 2, items: [] },
    ])
    expect(doc.emptyPages).toEqual([2])
    expect(toPromptText(doc.pages)).toBe('=== PAGE 1 ===\n2026 Annual Meeting\n\n=== PAGE 2 ===\n')
  })
})
