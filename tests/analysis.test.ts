import { describe, expect, it } from 'vitest'
import { demoDigest } from '../src/demo/demoDigest'
import {
  conferenceDays,
  countablePresentations,
  formatDay,
  formatTime,
  NO_FILTERS,
  rankInstitutions,
  rankPeople,
  rankThemes,
  searchPresentations,
  totals,
} from '../src/lib/digest/analysis'
import { applySummary, summaryUserMessage } from '../src/lib/extraction/summary'

// The demo conference has 29 presentations; one is withdrawn and one is in an industry
// symposium, so 27 count. The expected numbers below were worked out by hand from demoDigest.ts.

const search = (change: Partial<typeof NO_FILTERS>) => searchPresentations(demoDigest, { ...NO_FILTERS, ...change })

describe('counting', () => {
  it('leaves out withdrawn abstracts and non-scientific sessions', () => {
    const ids = countablePresentations(demoDigest).map((p) => p.id)
    expect(ids).toHaveLength(27)
    expect(ids).not.toContain('p-5') // withdrawn
    expect(ids).not.toContain('p-industry') // industry symposium
  })

  it('totals the headline numbers', () => {
    expect(totals(demoDigest, 'presenters')).toMatchObject({ sessions: 9, presentations: 27 })
    expect(totals(demoDigest, 'authors').people).toBeGreaterThan(totals(demoDigest, 'presenters').people)
  })

  it('ranks themes by number of presentations', () => {
    expect(rankThemes(demoDigest)[0]).toMatchObject({ label: 'Inflammatory Bowel Disease', count: 6 })
  })

  it('ranks presenters, breaking ties alphabetically', () => {
    const top = rankPeople(demoDigest, 'presenters').slice(0, 3)
    expect(top.map((p) => [p.label, p.count])).toEqual([
      ['Kenji Arakawa', 2],
      ['Owen Gallagher', 2],
      ['Zainab Yusuf', 2],
    ])
  })

  it('counts an institution once per presentation, by presenters or by all authors', () => {
    const count = (mode: 'presenters' | 'authors') => rankInstitutions(demoDigest, mode).find((i) => i.id === 'lusm')!.count
    expect(count('presenters')).toBe(4)
    expect(count('authors')).toBe(7)
  })
})

describe('searchPresentations', () => {
  it('finds a word in a title', () => {
    expect(search({ query: 'calprotectin' }).map((p) => p.abstract_number)).toEqual(['101'])
  })

  it('finds an institution by another of its spellings', () => {
    const byAlias = search({ query: 'childrens hospital bayport' })
    expect(byAlias.length).toBeGreaterThan(0)
  })

  it('combines day and type filters, in schedule order', () => {
    const results = search({ day: '2026-04-18', kind: 'posters' })
    expect(results.map((p) => p.abstract_number)).toEqual(['8', '9', '10', '11', '12', '13'])
  })

  it('lists exactly what a chart counted, in either people mode', () => {
    expect(search({ institutionId: 'lusm', peopleMode: 'presenters' })).toHaveLength(4)
    expect(search({ institutionId: 'lusm', peopleMode: 'authors' })).toHaveLength(7)
  })

  it('lists the conference days', () => {
    expect(conferenceDays(demoDigest)).toEqual(['2026-04-17', '2026-04-18'])
  })
})

describe('formatting', () => {
  it('shows 12-hour times and short dates', () => {
    expect(formatTime('14:28')).toBe('2:28 PM')
    expect(formatTime('00:05')).toBe('12:05 AM')
    expect(formatTime('12:00')).toBe('12:00 PM')
    expect(formatDay('2026-04-17')).toBe('Fri, Apr 17')
  })
})

describe('summary', () => {
  it('gives Claude the candidates with their ids', () => {
    const message = summaryUserMessage(demoDigest)
    expect(message).toContain('[p-keynote-open]')
    expect(message).toContain("Founders' Keynote Lecture")
  })

  it('keeps only citations of presentations that exist', () => {
    const digest = structuredClone(demoDigest)
    applySummary(digest, {
      summary: '  A short overview.  ',
      highlights: [{ text: 'The keynote', presentation_ids: ['p-keynote-open', 'p-made-up'] }],
    })
    expect(digest.conference.summary).toBe('A short overview.')
    expect(digest.conference.highlights).toEqual([{ text: 'The keynote', presentation_ids: ['p-keynote-open'] }])
  })
})
