import { describe, expect, it } from 'vitest'
import { digestToGolden, GoldenSlice } from '../eval/golden'
import { matchPresentations, prf, scoreSlice, titleSimilarity } from '../eval/scoring'
import { demoDigest } from '../src/demo/demoDigest'
import type { Digest } from '../src/lib/extraction/schema'

// The demo conference is correct by construction, so its own golden file should score perfectly,
// and each deliberate mistake below should lower exactly the score it affects.
const slice = { id: 'demo', description: 'The whole fictional demo program', pages: Array.from({ length: 13 }, (_, i) => i + 1) }
const golden = digestToGolden(demoDigest, slice)

function copy(): Digest {
  return structuredClone(demoDigest)
}

describe('prf', () => {
  it('computes precision, recall and F1 from counts', () => {
    expect(prf(8, 2, 2)).toMatchObject({ precision: 0.8, recall: 0.8, f1: expect.closeTo(0.8) })
    expect(prf(0, 0, 0)).toMatchObject({ precision: 1, recall: 1, f1: 1 })
  })
})

describe('the demo golden file', () => {
  it('is a valid golden file', () => {
    expect(GoldenSlice.safeParse(golden).success).toBe(true)
  })

  it('scores the demo digest as perfect', () => {
    const score = scoreSlice(golden, demoDigest)
    for (const key of ['presentations', 'presenters', 'authors', 'institutions', 'distinctInstitutions', 'sessions'] as const) {
      expect(score[key].f1, key).toBe(1)
    }
    expect(Object.values(score.fields).every((f) => f.accuracy === 1)).toBe(true)
  })
})

describe('scoreSlice catches each kind of mistake', () => {
  it('a missed presentation lowers recall, not precision', () => {
    const digest = copy()
    digest.presentations = digest.presentations.filter((p) => p.abstract_number !== '3')
    const score = scoreSlice(golden, digest)
    expect(score.presentations.recall).toBeLessThan(1)
    expect(score.presentations.precision).toBe(1)
    expect(score.missed).toHaveLength(1)
  })

  it('an invented presentation lowers precision, not recall', () => {
    const digest = copy()
    digest.presentations.push({ ...digest.presentations[0]!, id: 'p-fake', abstract_number: '999', title: 'A Talk That Does Not Exist' })
    const score = scoreSlice(golden, digest)
    expect(score.presentations.precision).toBeLessThan(1)
    expect(score.presentations.recall).toBe(1)
  })

  it('a wrong time lowers time accuracy only', () => {
    const digest = copy()
    digest.presentations.find((p) => p.id === 'p-101')!.start_time = '09:05'
    const score = scoreSlice(golden, digest)
    expect(score.fields.start_time.accuracy).toBeLessThan(1)
    expect(score.fields.room.accuracy).toBe(1)
    expect(score.presentations.f1).toBe(1)
  })

  it('a missing author lowers author recall', () => {
    const digest = copy()
    const p = digest.presentations.find((x) => x.id === 'p-101')!
    p.authors = p.authors.slice(0, 1)
    expect(scoreSlice(golden, digest).authors.recall).toBeLessThan(1)
  })

  it('an alias spelling of an institution still counts as correct', () => {
    const digest = copy()
    const bch = digest.institutions.find((i) => i.id === 'bch')!
    bch.canonical_name = 'Bayport Childrens Hospital' // one of its known aliases
    expect(scoreSlice(golden, digest).institutions.f1).toBe(1)
  })

  it('an unmerged duplicate institution counts against distinct institutions', () => {
    const digest = copy()
    digest.institutions.push({ ...digest.institutions[0]!, id: 'dup', canonical_name: 'Bayport Pediatric Center' })
    digest.affiliations.find((a) => a.id === 'aff-bch-plain')!.institution_id = 'dup'
    expect(scoreSlice(golden, digest).distinctInstitutions.precision).toBeLessThan(1)
  })
})

describe('matching', () => {
  it('pairs by abstract number first, then by nearly identical titles', () => {
    const g = golden.presentations
    const predicted = g.map((p) => ({ ...p }))
    predicted[0] = { ...predicted[0]!, title: predicted[0]!.title.toUpperCase() } // same title, different case
    predicted[1] = { ...predicted[1]!, abstract_number: null } // number dropped, title intact
    const { pairs, missed, extra } = matchPresentations(g, predicted)
    expect([pairs.length, missed.length, extra.length]).toEqual([g.length, 0, 0])
  })

  it('treats clearly different titles as different', () => {
    expect(titleSimilarity('Iron deficiency at diagnosis', 'IRON DEFICIENCY AT DIAGNOSIS')).toBe(1)
    expect(titleSimilarity('Iron deficiency at diagnosis', 'Bile acids after Kasai')).toBeLessThan(0.3)
  })
})
