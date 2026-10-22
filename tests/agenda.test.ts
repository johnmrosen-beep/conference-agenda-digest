import { describe, expect, it } from 'vitest'
import { demoDigest } from '../src/demo/demoDigest'
import { buildAgenda } from '../src/lib/digest/agenda'
import { agendaFileName, agendaPdf, pdfSafe } from '../src/lib/export/agendaPdf'

// Picks from the fictional demo conference. On Friday, two concurrent sessions start at 10:00 in
// Rooms 201 and 202; abstract 103 has no printed time; poster 1 stands from 12:00 to 13:30.
// Real programs print only start times for talks, so the end times are removed here, as in the
// NASPGHAN program, to exercise the estimates.
const digest = structuredClone(demoDigest)
for (const p of digest.presentations) {
  if (p.kind !== 'poster' && !p.time_inferred) p.end_time = null
}
const picks = ['p-ibd-talk-1', 'p-nut-talk-1', 'p-102', 'p-103', 'p-1', 'p-keynote-close']
const days = buildAgenda(digest, picks)
const item = (id: string) => days.flatMap((d) => d.items).find((i) => i.presentation.id === id)!

describe('buildAgenda', () => {
  it('groups picks by day, in time order', () => {
    expect(days.map((d) => d.date)).toEqual(['2026-04-17', '2026-04-18'])
    expect(days[0]!.items.map((i) => i.presentation.id)).toEqual(['p-ibd-talk-1', 'p-nut-talk-1', 'p-103', 'p-102', 'p-1'])
  })

  it("ends a talk when the next talk in its session starts", () => {
    expect([item('p-ibd-talk-1').end, item('p-ibd-talk-1').endEstimated]).toEqual(['10:25', true])
    // Abstract 103 has no printed time, so the next timed talk in that session is at 10:50.
    expect(item('p-nut-talk-1').end).toBe('10:50')
  })

  it("falls back to the session's end for the last talk", () => {
    expect(item('p-keynote-close').end).toBe('15:00')
  })

  it('flags picks that overlap in different rooms, but not back-to-back talks in one room', () => {
    expect(item('p-ibd-talk-1').clashes.map((c) => c.title)).toEqual([item('p-nut-talk-1').presentation.title])
    expect(item('p-102').clashes.map((c) => c.title)).toEqual([item('p-nut-talk-1').presentation.title])
    expect(item('p-nut-talk-1').clashes).toHaveLength(2)
  })

  it('never flags posters or items without a printed time', () => {
    expect(item('p-1').clashes).toEqual([])
    expect(item('p-103').timeNotPrinted).toBe(true)
    expect(item('p-103').clashes).toEqual([])
  })

  it('lists presenters and their institutions', () => {
    expect(item('p-ibd-talk-1').presenters).toEqual(['Daniel Ferreira'])
    expect(item('p-ibd-talk-1').institutions).toEqual(["Riverbend Children's Health"])
  })

  it('returns nothing when nothing is picked', () => {
    expect(buildAgenda(digest, [])).toEqual([])
  })
})

describe('agendaPdf', () => {
  it('makes a PDF with the conference, the picks and the clash notes', () => {
    const pdf = agendaPdf(digest, days, new Date(2026, 9, 23)).output()
    expect(pdf.startsWith('%PDF')).toBe(true)
    expect(pdf).toContain('Great Lakes Pediatric') // the title may wrap onto a second line
    expect(pdf).toContain('Overlaps with:')
    expect(pdf).toContain('Time TBA')
  })

  it('names the file after the conference', () => {
    expect(agendaFileName(demoDigest)).toBe('My agenda - GLPDF 2026.pdf')
  })

  it('keeps accented letters and spells out symbols the built-in fonts lack', () => {
    expect(pdfSafe('Moreno-Ibáñez, α ≥ 5')).toBe('Moreno-Ibáñez, alpha >= 5')
    expect(pdfSafe('北京')).toBe('??')
  })
})
