// Scores a model's digest against a golden slice. Plain functions, no API calls, unit-tested.
//
// The two numbers that matter, in clinical terms:
//   precision = of everything the model reported, the share that is really there and right
//               (like positive predictive value)
//   recall    = of everything really there, the share the model found (like sensitivity)
//   F1        = one number that balances the two (their harmonic mean)
//
// Steps:
//   1. Pair each predicted presentation with a golden one: same abstract number, or failing
//      that, nearly the same title. Unpaired golden items are misses; unpaired predictions
//      are extras (invented, split, or duplicated items).
//   2. On the pairs, check each field (date, time, room, session, kind, number).
//   3. Compare the people and institutions listed on each pair.

import { institutionKey, personKey } from '../src/lib/extraction/merge'
import { normalizeForMatch } from '../src/lib/extraction/validate'
import type { Digest } from '../src/lib/extraction/schema'
import { digestToGolden, type GoldenPresentation, type GoldenSession, type GoldenSlice } from './golden'

export interface PRF {
  tp: number
  fp: number
  fn: number
  precision: number
  recall: number
  f1: number
}

export function prf(tp: number, fp: number, fn: number): PRF {
  // With nothing to find and nothing reported, the answer is perfect, not undefined.
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { tp, fp, fn, precision, recall, f1 }
}

/** Adds up counts from several slices or runs, then recomputes the rates ("micro-averaging"). */
export function sumPrf(parts: PRF[]): PRF {
  return prf(
    parts.reduce((n, p) => n + p.tp, 0),
    parts.reduce((n, p) => n + p.fp, 0),
    parts.reduce((n, p) => n + p.fn, 0),
  )
}

/** How alike two titles are, from 0 to 1, by the words they share (Dice coefficient). */
export function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForMatch(a).split(' ').filter(Boolean))
  const wordsB = new Set(normalizeForMatch(b).split(' ').filter(Boolean))
  if (wordsA.size === 0 && wordsB.size === 0) return 1
  let shared = 0
  for (const w of wordsA) if (wordsB.has(w)) shared++
  return (2 * shared) / (wordsA.size + wordsB.size)
}

const TITLE_MATCH = 0.85

function numberKey(n: string | null): string | null {
  const key = n?.replace(/[^0-9a-z]/gi, '').toLowerCase()
  return key ? key : null
}

export interface PresentationPair {
  golden: GoldenPresentation
  predicted: GoldenPresentation
}

export function matchPresentations(
  golden: GoldenPresentation[],
  predicted: GoldenPresentation[],
): { pairs: PresentationPair[]; missed: GoldenPresentation[]; extra: GoldenPresentation[] } {
  const pairs: PresentationPair[] = []
  const freeGolden = new Set(golden)
  const freePredicted = new Set(predicted)

  // 1. Same abstract number.
  for (const g of golden) {
    const key = numberKey(g.abstract_number)
    if (!key) continue
    const p = [...freePredicted].find((candidate) => numberKey(candidate.abstract_number) === key)
    if (p) {
      pairs.push({ golden: g, predicted: p })
      freeGolden.delete(g)
      freePredicted.delete(p)
    }
  }

  // 2. Nearly the same title, best matches first.
  const candidates: { g: GoldenPresentation; p: GoldenPresentation; score: number }[] = []
  for (const g of freeGolden) {
    for (const p of freePredicted) {
      const score = titleSimilarity(g.title, p.title)
      if (score >= TITLE_MATCH) candidates.push({ g, p, score })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  for (const { g, p } of candidates) {
    if (!freeGolden.has(g) || !freePredicted.has(p)) continue
    pairs.push({ golden: g, predicted: p })
    freeGolden.delete(g)
    freePredicted.delete(p)
  }

  return { pairs, missed: [...freeGolden], extra: [...freePredicted] }
}

export const FIELDS = ['abstract_number', 'kind', 'session', 'date', 'start_time', 'end_time', 'room'] as const
export type Field = (typeof FIELDS)[number]

export interface FieldScore {
  correct: number
  total: number
  accuracy: number
}

function fieldValue(p: GoldenPresentation, field: Field): string | null {
  switch (field) {
    case 'abstract_number':
      return numberKey(p.abstract_number)
    case 'session':
      return p.session_title === null ? null : normalizeForMatch(p.session_title)
    case 'room':
      return p.room === null ? null : normalizeForMatch(p.room)
    default:
      return p[field]
  }
}

function scoreFields(pairs: PresentationPair[]): Record<Field, FieldScore> {
  const result = {} as Record<Field, FieldScore>
  for (const field of FIELDS) {
    let correct = 0
    let total = 0
    for (const { golden, predicted } of pairs) {
      const expected = fieldValue(golden, field)
      if (expected === null) continue // not knowable from the PDF, so not scored
      total++
      if (fieldValue(predicted, field) === expected) correct++
    }
    result[field] = { correct, total, accuracy: total === 0 ? 1 : correct / total }
  }
  return result
}

/** One wrong field on a matched presentation, for finding patterns in the errors. */
export interface FieldError {
  field: Field
  item: string
  expected: string
  got: string
}

function listFieldErrors(pairs: PresentationPair[]): FieldError[] {
  const errors: FieldError[] = []
  for (const { golden, predicted } of pairs) {
    for (const field of FIELDS) {
      const expected = fieldValue(golden, field)
      if (expected === null) continue
      const got = fieldValue(predicted, field)
      if (got !== expected) {
        errors.push({
          field,
          item: `${golden.abstract_number ?? '-'} ${golden.title.slice(0, 60)}`,
          expected,
          got: got ?? '(none)',
        })
      }
    }
  }
  return errors
}

/** Compares two lists of names (or institutions) as sets, after normalizing each one. */
function compareSets(golden: string[], predicted: string[], key: (s: string) => string): PRF {
  const g = new Set(golden.map(key).filter(Boolean))
  const p = new Set(predicted.map(key).filter(Boolean))
  let tp = 0
  for (const item of p) if (g.has(item)) tp++
  return prf(tp, p.size - tp, g.size - tp)
}

/** Maps any spelling of an institution to one key, using the golden file's alias list. */
export function institutionKeyFor(slice: GoldenSlice): (name: string) => string {
  const canonical = new Map<string, string>()
  for (const [name, variants] of Object.entries(slice.institution_aliases)) {
    for (const spelling of [name, ...variants]) canonical.set(institutionKey(spelling), institutionKey(name))
  }
  return (name) => {
    const key = institutionKey(name)
    return canonical.get(key) ?? key
  }
}

function matchSessions(golden: GoldenSession[], predicted: GoldenSession[]) {
  const pairs: { golden: GoldenSession; predicted: GoldenSession }[] = []
  const free = new Set(predicted)
  for (const g of golden) {
    const best = [...free]
      .map((p) => ({ p, score: titleSimilarity(g.title, p.title) }))
      .filter((c) => c.score >= 0.8)
      .sort((a, b) => b.score - a.score)[0]
    if (best) {
      pairs.push({ golden: g, predicted: best.p })
      free.delete(best.p)
    }
  }
  const fields = (['date', 'start_time', 'end_time', 'room'] as const).map((field) => {
    const scored = pairs.filter((pair) => pair.golden[field] !== null)
    const correct = scored.filter((pair) =>
      field === 'room'
        ? normalizeForMatch(pair.predicted.room ?? '') === normalizeForMatch(pair.golden.room ?? '')
        : pair.predicted[field] === pair.golden[field],
    ).length
    return [field, { correct, total: scored.length, accuracy: scored.length ? correct / scored.length : 1 }] as const
  })
  return {
    found: prf(pairs.length, predicted.length - pairs.length, golden.length - pairs.length),
    fields: Object.fromEntries(fields) as Record<'date' | 'start_time' | 'end_time' | 'room', FieldScore>,
  }
}

export interface SliceScore {
  slice: string
  presentations: PRF
  presenters: PRF
  authors: PRF
  /** Institutions listed on each presentation (extraction plus name merging). */
  institutions: PRF
  /** The distinct institutions across the slice, as a chart would count them. */
  distinctInstitutions: PRF
  sessions: PRF
  fields: Record<Field, FieldScore>
  sessionFields: Record<'date' | 'start_time' | 'end_time' | 'room', FieldScore>
  /** Titles of golden items the model missed, and of items it reported that aren't golden. */
  missed: string[]
  extra: string[]
  /** Every wrong field on a matched presentation (private: includes titles). */
  fieldErrors: FieldError[]
}

export function scoreSlice(golden: GoldenSlice, digest: Digest): SliceScore {
  const predicted = digestToGolden(digest, golden)
  const { pairs, missed, extra } = matchPresentations(golden.presentations, predicted.presentations)
  const instKey = institutionKeyFor(golden)

  const people = (pick: (p: GoldenPresentation) => string[]) => {
    const parts = pairs.map(({ golden: g, predicted: p }) => compareSets(pick(g), pick(p), personKey))
    parts.push(...missed.map((g) => compareSets(pick(g), [], personKey)))
    parts.push(...extra.map((p) => compareSets([], pick(p), personKey)))
    return sumPrf(parts)
  }

  const institutionParts = pairs.map(({ golden: g, predicted: p }) => compareSets(g.institutions, p.institutions, instKey))
  institutionParts.push(...missed.map((g) => compareSets(g.institutions, [], instKey)))
  institutionParts.push(...extra.map((p) => compareSets([], p.institutions, instKey)))

  const sessions = matchSessions(golden.sessions, predicted.sessions)

  return {
    slice: golden.id,
    presentations: prf(pairs.length, extra.length, missed.length),
    presenters: people((p) => p.presenters),
    authors: people((p) => p.authors),
    institutions: sumPrf(institutionParts),
    distinctInstitutions: compareSets(
      golden.presentations.flatMap((p) => p.institutions),
      predicted.presentations.flatMap((p) => p.institutions),
      instKey,
    ),
    sessions: sessions.found,
    fields: scoreFields(pairs),
    sessionFields: sessions.fields,
    missed: missed.map((g) => `${g.abstract_number ?? '-'} ${g.title}`),
    extra: extra.map((p) => `${p.abstract_number ?? '-'} ${p.title}`),
    fieldErrors: listFieldErrors(pairs),
  }
}
