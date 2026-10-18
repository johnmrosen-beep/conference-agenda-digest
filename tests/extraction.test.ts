import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { describe, expect, it } from 'vitest'
import type { CleanPage } from '../src/lib/pdf/cleanText'
import { makeChunks } from '../src/lib/extraction/chunk'
import { parseAnswer } from '../src/lib/extraction/claude'
import {
  cleanDate,
  cleanTime,
  guessInstitutionType,
  institutionKey,
  mergeDigest,
  type ChunkResult,
} from '../src/lib/extraction/merge'
import {
  ChunkOutput,
  OutlineOutput,
  type ChunkPresentation,
  type OutlineOutput as Outline,
} from '../src/lib/extraction/modelOutput'
import { costOfCall } from '../src/lib/extraction/pricing'
import { checkDigest, parseDigest } from '../src/lib/extraction/validate'

// None of these tests call the API: they check our own code around it, using made-up answers.

function page(pageNumber: number, chars: number): CleanPage {
  return { pageNumber, text: 'x'.repeat(chars) }
}

describe('makeChunks', () => {
  it('groups pages up to the size limit and adds the previous page as context', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => page(n, 400))
    const chunks = makeChunks(pages, { maxChars: 1000 })
    expect(chunks.map((c) => c.extractPages)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunks.map((c) => c.contextPages)).toEqual([[], [2], [4]])
    expect(chunks[1]!.text).toContain('=== PAGE 2 ===')
  })

  it('leaves out skipped and empty pages, and never splits across a gap', () => {
    const pages = [page(1, 100), page(2, 100), { pageNumber: 3, text: '' }, page(4, 100), page(5, 100)]
    const chunks = makeChunks(pages, { skipPages: [2] })
    expect(chunks.map((c) => c.extractPages)).toEqual([[1], [4, 5]])
    expect(chunks[1]!.contextPages).toEqual([]) // page 3 is empty, so no context page
  })
})

describe('structured output schemas', () => {
  it('convert into formats the API accepts', () => {
    for (const schema of [OutlineOutput, ChunkOutput]) {
      const format = zodOutputFormat(schema)
      expect(format.type).toBe('json_schema')
      expect(JSON.stringify(format.schema)).toContain('"additionalProperties":false')
    }
  })
})

describe('parseAnswer', () => {
  it('reads a complete answer', () => {
    expect(parseAnswer('{"presentations":[]}', ChunkOutput)).toEqual({ presentations: [] })
  })

  it('returns null for an answer cut off partway, instead of crashing', () => {
    expect(parseAnswer('{"presentations":[{"page":2,"ti', ChunkOutput)).toBeNull()
    expect(parseAnswer('', ChunkOutput)).toBeNull()
  })

  it('returns null for JSON in the wrong shape', () => {
    expect(parseAnswer('{"items":[]}', ChunkOutput)).toBeNull()
  })
})

describe('pricing', () => {
  it('prices a Sonnet call from its token counts', () => {
    expect(costOfCall('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 100_000 })).toBeCloseTo(3)
  })

  it('uses Haiku’s higher price once a prompt passes 100k tokens', () => {
    expect(costOfCall('claude-haiku-5-5', { input_tokens: 50_000, output_tokens: 0 })).toBeCloseTo(0.005)
    expect(costOfCall('claude-haiku-5-5', { input_tokens: 200_000, output_tokens: 0 })).toBeCloseTo(0.1)
  })
})

describe('merge helpers', () => {
  it('accepts only real dates and 24-hour times', () => {
    expect(cleanDate('2026-04-17')).toBe('2026-04-17')
    expect(cleanDate('2026-02-30')).toBeNull()
    expect(cleanDate('April 17')).toBeNull()
    expect(cleanTime('8:05')).toBe('08:05')
    expect(cleanTime('25:00')).toBeNull()
    expect(cleanTime('8:05 AM')).toBeNull()
  })

  it('treats spelling variants of an institution as one', () => {
    expect(institutionKey("The Bayport Children's Hospital")).toBe(institutionKey('Bayport Childrens Hospital'))
    expect(institutionKey('St. Agnes Pediatric Institute')).toBe(institutionKey('Saint Agnes Pediatric Institute'))
    expect(institutionKey('Lakeshore Univ. School of Medicine')).toBe(institutionKey('Lakeshore University School of Medicine'))
    expect(institutionKey('Cedar Valley University')).not.toBe(institutionKey('Prairie State University'))
  })

  it('guesses institution types from their names', () => {
    expect(guessInstitutionType("Bayport Children's Hospital")).toBe('childrens_hospital')
    expect(guessInstitutionType('Cedar Valley University')).toBe('university')
    expect(guessInstitutionType('Harbor Nutrition Labs')).toBe('industry')
  })
})

// ---------------------------------------------------------------- a full merge with fake answers

const outline: Outline = {
  conference: {
    name: 'Example Forum',
    acronym: null,
    year: 2026,
    organizers: [],
    start_date: '2026-04-17',
    end_date: '2026-04-18',
    venue: null,
    city: 'Bayport',
    region: 'MI',
    country: 'USA',
  },
  doc_kind: 'program',
  sessions: [
    {
      title: 'Poster Session 1',
      series: null,
      session_type: 'poster_session',
      is_scientific: true,
      date: '2026-04-17',
      start_time: '12:00',
      end_time: '13:30',
      room: 'Exhibit Hall B',
      moderators: [],
      first_page: 2,
      last_page: 3,
    },
    {
      title: 'Opening Plenary',
      series: null,
      session_type: 'plenary',
      is_scientific: true,
      date: '2026-04-17',
      start_time: '08:00',
      end_time: '09:30',
      room: 'Lakeview Ballroom',
      moderators: [{ name: 'Grace Whitfield', credentials: 'MD', institution: null }],
      first_page: 1,
      last_page: 1,
    },
  ],
  themes: [{ label: 'Inflammatory Bowel Disease', description: 'IBD', from_document: true }],
  skip_pages: [],
}

function poster(overrides: Partial<ChunkPresentation>): ChunkPresentation {
  return {
    page: 2,
    session_title: 'Poster Session 1',
    abstract_number: '1',
    title: 'IRON DEFICIENCY AT DIAGNOSIS',
    kind: 'poster',
    award_label: null,
    is_highlighted: false,
    withdrawn: false,
    date: null,
    start_time: null,
    end_time: null,
    room: null,
    people_are_speakers: false,
    people: [
      { name: 'Benjamin Hale', credentials: null, affiliation_markers: ['1'] },
      { name: 'Leila Haddad', credentials: null, affiliation_markers: ['1', '2'] },
    ],
    affiliations: [
      { marker: '1', raw_text: "The Bayport Children's Hospital, Bayport, MI", department: null, institution: "The Bayport Children's Hospital", city: 'Bayport', region: 'MI', country: 'USA' },
      { marker: '2', raw_text: 'Bayport Childrens Hospital, Bayport, MI', department: null, institution: 'Bayport Childrens Hospital', city: 'Bayport', region: 'MI', country: 'USA' },
    ],
    source_category: 'INFLAMMATORY BOWEL DISEASE',
    themes: ['Inflammatory Bowel Disease', 'Not A Theme'],
    ...overrides,
  }
}

function chunkResult(extractPages: number[], presentations: ChunkPresentation[]): ChunkResult {
  return { chunk: { index: 0, extractPages, contextPages: [], text: '' }, presentations }
}

const merged = mergeDigest({
  source: { file_name: 'example.pdf', sha256: null, page_count: 3, doc_kind: 'program', extracted_with: null },
  outline,
  chunks: [
    chunkResult([1], [
      {
        ...poster({}),
        page: 1,
        session_title: 'Opening Plenary',
        abstract_number: null,
        title: 'The Gut at Every Age',
        kind: 'keynote',
        start_time: '8:10',
        end_time: '8:55',
        people_are_speakers: true,
        people: [{ name: 'Maya Okonkwo', credentials: 'MD, MPH', affiliation_markers: [] }],
        affiliations: [{ marker: null, raw_text: "Bayport Children's Hospital", department: null, institution: "Bayport Children's Hospital", city: null, region: null, country: null }],
        source_category: null,
      },
    ]),
    chunkResult([2], [poster({}), poster({ abstract_number: '2', title: 'INTESTINAL ULTRASOUND IN CHILDREN', people: [] })]),
    // The next chunk sees poster 1 again on its context page, and poster 2 again with authors.
    chunkResult([3], [
      poster({ page: 2 }),
      poster({ page: 3, abstract_number: '2', title: 'INTESTINAL ULTRASOUND IN CHILDREN' }),
    ]),
  ],
})

describe('mergeDigest', () => {
  it('produces a digest that passes the shape check', () => {
    const result = parseDigest(merged)
    expect(result.ok ? [] : result.problems).toEqual([])
    expect(checkDigest(merged).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('drops duplicates, keeping the fuller copy', () => {
    expect(merged.presentations.map((p) => p.abstract_number)).toEqual([null, '1', '2'])
    expect(merged.presentations[2]!.authors).toHaveLength(2)
  })

  it('copies the session time and room to posters that print none', () => {
    const p1 = merged.presentations[1]!
    expect([p1.date, p1.start_time, p1.end_time, p1.room, p1.time_inferred]).toEqual([
      '2026-04-17', '12:00', '13:30', 'Exhibit Hall B', true,
    ])
  })

  it('keeps a printed time and marks speakers for talks', () => {
    const keynote = merged.presentations[0]!
    expect([keynote.start_time, keynote.end_time, keynote.room, keynote.time_inferred]).toEqual([
      '08:10', '08:55', 'Lakeview Ballroom', true,
    ])
    expect(keynote.speaker_ids).toHaveLength(1)
    expect(keynote.authors[0]!.affiliation_ids).toHaveLength(1) // unnumbered single affiliation
  })

  it('merges spelling variants into one institution and one person per name', () => {
    expect(merged.institutions).toHaveLength(1)
    expect(merged.institutions[0]!.aliases.length).toBeGreaterThan(0)
    expect(merged.people.filter((p) => p.display_name === 'Benjamin Hale')).toHaveLength(1)
  })

  it('keeps only themes from the outline list', () => {
    expect(merged.presentations[1]!.theme_ids).toEqual(['theme-1'])
  })
})
