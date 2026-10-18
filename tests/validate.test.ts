import { describe, expect, it } from 'vitest'
import { demoDigest } from '../src/demo/demoDigest'
import { presenterIds, type Digest } from '../src/lib/extraction/schema'
import { appearsIn, checkDigest, normalizeForMatch, parseDigest } from '../src/lib/extraction/validate'

// A fresh, editable copy of the demo digest for each test, so one test's change can't leak
// into another.
function copy(): Digest {
  return structuredClone(demoDigest)
}

function codes(digest: Digest, pageTexts?: Map<number, string>): string[] {
  return checkDigest(digest, { pageTexts }).map((issue) => issue.code)
}

describe('the demo digest', () => {
  it('has the right shape', () => {
    const result = parseDigest(demoDigest)
    expect(result.ok ? [] : result.problems).toEqual([])
  })

  it('passes every meaning check', () => {
    expect(checkDigest(demoDigest)).toEqual([])
  })

  it('survives a round trip through JSON, as an exported file would', () => {
    expect(parseDigest(JSON.parse(JSON.stringify(demoDigest))).ok).toBe(true)
  })
})

describe('parseDigest (shape)', () => {
  it('rejects a badly formatted time and says where it is', () => {
    const digest: unknown = { ...copy(), sessions: [{ ...copy().sessions[0], start_time: '8:00 AM' }] }
    const result = parseDigest(digest)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join('\n')).toContain('sessions.0.start_time')
  })

  it('rejects unknown fields, which usually mean a typo', () => {
    const digest: unknown = { ...copy(), presentation: [] }
    expect(parseDigest(digest).ok).toBe(false)
  })
})

describe('checkDigest (meaning)', () => {
  it('flags a date outside the conference', () => {
    const digest = copy()
    digest.sessions[0]!.date = '2026-04-08'
    expect(codes(digest)).toContain('DATE_OUTSIDE_CONFERENCE')
  })

  it('flags a session that ends before it starts', () => {
    const digest = copy()
    digest.sessions[0]!.end_time = '07:30'
    expect(codes(digest)).toContain('TIME_ORDER')
  })

  it('flags a talk scheduled outside its session', () => {
    const digest = copy()
    digest.presentations[0]!.start_time = '13:00'
    digest.presentations[0]!.end_time = '13:30'
    expect(codes(digest)).toContain('OUTSIDE_SESSION_TIME')
  })

  it('flags a repeated abstract number', () => {
    const digest = copy()
    const poster = digest.presentations.find((p) => p.abstract_number === '2')!
    poster.abstract_number = '1'
    expect(codes(digest)).toContain('DUPLICATE_ABSTRACT_NUMBER')
  })

  it('flags links to records that do not exist, and repeated ids', () => {
    const digest = copy()
    digest.presentations[0]!.speaker_ids = ['nobody']
    digest.people.push({ ...digest.people[0]! })
    expect(codes(digest)).toEqual(expect.arrayContaining(['BROKEN_REFERENCE', 'DUPLICATE_ID']))
  })

  it('flags page numbers beyond the end of the PDF', () => {
    const digest = copy()
    digest.presentations[0]!.source_pages = [99]
    expect(codes(digest)).toContain('PAGE_OUT_OF_RANGE')
  })

  it('flags a presentation with nobody presenting, unless it was withdrawn', () => {
    const digest = copy()
    digest.presentations[0]!.speaker_ids = []
    digest.presentations[0]!.authors = []
    expect(codes(digest)).toContain('MISSING_PRESENTER')
    expect(demoDigest.presentations.some((p) => p.withdrawn && p.authors.length === 0)).toBe(true)
  })
})

describe('grounding (is it really printed in the PDF?)', () => {
  const keynote = demoDigest.presentations.find((p) => p.id === 'p-keynote-open')!
  const page = keynote.source_pages[0]!

  it('accepts a title and speaker that appear on the cited page, despite formatting', () => {
    const text = 'OPENING PLENARY\n8:10 AM THE GUT AT EVERY AGE: A LIFESPAN VIEW OF PEDIATRIC DIGES-\ntIVE HEALTH\nMaya Okonkwo^1, MD, MPH'
    const pageTexts = new Map([[page, text]])
    const keynoteIssues = checkDigest(demoDigest, { pageTexts }).filter((i) => i.refId === keynote.id)
    expect(keynoteIssues).toEqual([])
  })

  it('flags a title and a name that are not on the cited page', () => {
    const pageTexts = new Map([[page, 'Opening Plenary\nWelcome and announcements']])
    const keynoteCodes = checkDigest(demoDigest, { pageTexts })
      .filter((i) => i.refId === keynote.id)
      .map((i) => i.code)
    expect(keynoteCodes).toEqual(['TITLE_NOT_IN_SOURCE', 'NAME_NOT_IN_SOURCE'])
  })
})

describe('text matching helpers', () => {
  it('ignores case, accents, apostrophes and superscript markers', () => {
    expect(normalizeForMatch('Moreno-Ibáñez^1,2')).toBe('moreno ibanez')
    expect(appearsIn("Bayport Children's Hospital", 'BAYPORT CHILDRENS HOSPITAL, Bayport, MI')).toBe(true)
  })

  it('matches whole words only', () => {
    expect(appearsIn('Park', 'Parkinson disease')).toBe(false)
  })

  it('accepts a long title stored slightly out of order, but not an unrelated one', () => {
    const text = 'Predict Early Fecal Calprotectin Trajectories Steroid-Free Remission in Pediatric Crohn Disease'
    expect(appearsIn('Early Fecal Calprotectin Trajectories Predict Steroid-Free Remission in Pediatric Crohn Disease', text)).toBe(true)
    expect(appearsIn('Bile Acids After Kasai Portoenterostomy', text)).toBe(false)
  })
})

describe('presenterIds', () => {
  it('uses the speakers for talks and the first author for abstracts', () => {
    const talk = demoDigest.presentations.find((p) => p.id === 'p-ibd-talk-1')!
    const abstract = demoDigest.presentations.find((p) => p.id === 'p-101')!
    expect(presenterIds(talk)).toEqual(['ferreira'])
    expect(presenterIds(abstract)).toEqual(['brennan'])
  })
})
