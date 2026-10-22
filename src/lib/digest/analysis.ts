// Questions the screens ask of a digest: what's most common, and which presentations match a
// search. Plain functions over the digest, unit-tested in tests/analysis.test.ts.
//
// Counting rules:
//   - Only scientific sessions count (no sponsor events, socials or business meetings), and
//     withdrawn abstracts never count.
//   - "Presenters" means speakers for talks and the first author for abstracts (docs/plan.md);
//     "all authors" counts everyone listed. The screens offer both.
//   - A presentation counts once per theme, institution or person, however many of its
//     authors share it.

import { presenterIds, type Digest, type Presentation } from '../extraction/schema'
import { normalizeForMatch } from '../extraction/validate'

export type PeopleMode = 'presenters' | 'authors'

export interface Ranked {
  id: string
  label: string
  count: number
}

/** Presentations that belong in charts and search: scientific and not withdrawn. */
export function countablePresentations(digest: Digest): Presentation[] {
  const scientific = new Set(digest.sessions.filter((s) => s.is_scientific).map((s) => s.id))
  return digest.presentations.filter(
    (p) => !p.withdrawn && (p.session_id === null || scientific.has(p.session_id)),
  )
}

function peopleOf(p: Presentation, mode: PeopleMode): string[] {
  return mode === 'presenters' ? presenterIds(p) : p.authors.map((a) => a.person_id)
}

/** Institution ids for a presentation's presenters (or all authors). */
export function institutionsOf(digest: Digest, p: Presentation, mode: PeopleMode): Set<string> {
  const people = new Set(peopleOf(p, mode))
  const institutionOf = new Map(digest.affiliations.map((a) => [a.id, a.institution_id]))
  const ids = new Set<string>()
  for (const author of p.authors) {
    if (!people.has(author.person_id)) continue
    for (const affiliationId of author.affiliation_ids) {
      const id = institutionOf.get(affiliationId)
      if (id) ids.add(id)
    }
  }
  return ids
}

function rank(counts: Map<string, number>, labelOf: (id: string) => string): Ranked[] {
  return [...counts]
    .map(([id, count]) => ({ id, label: labelOf(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function rankThemes(digest: Digest): Ranked[] {
  const counts = new Map<string, number>()
  for (const p of countablePresentations(digest)) {
    for (const id of new Set(p.theme_ids)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const labels = new Map(digest.themes.map((t) => [t.id, t.label]))
  return rank(counts, (id) => labels.get(id) ?? id)
}

export function rankInstitutions(digest: Digest, mode: PeopleMode): Ranked[] {
  const counts = new Map<string, number>()
  for (const p of countablePresentations(digest)) {
    for (const id of institutionsOf(digest, p, mode)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const labels = new Map(digest.institutions.map((i) => [i.id, i.canonical_name]))
  return rank(counts, (id) => labels.get(id) ?? id)
}

export function rankPeople(digest: Digest, mode: PeopleMode): Ranked[] {
  const counts = new Map<string, number>()
  for (const p of countablePresentations(digest)) {
    for (const id of new Set(peopleOf(p, mode))) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const labels = new Map(digest.people.map((person) => [person.id, person.display_name]))
  return rank(counts, (id) => labels.get(id) ?? id)
}

/** The headline numbers for the summary tiles. */
export function totals(digest: Digest, mode: PeopleMode) {
  const countable = countablePresentations(digest)
  return {
    sessions: digest.sessions.filter((s) => s.is_scientific).length,
    presentations: countable.length,
    people: new Set(countable.flatMap((p) => peopleOf(p, mode))).size,
    institutions: new Set(countable.flatMap((p) => [...institutionsOf(digest, p, mode)])).size,
  }
}

/** The conference days that have presentations, in order. */
export function conferenceDays(digest: Digest): string[] {
  return [...new Set(countablePresentations(digest).map((p) => p.date).filter((d): d is string => d !== null))].sort()
}

export type KindFilter = 'all' | 'talks' | 'abstracts' | 'posters'

export interface SearchFilters {
  query: string
  themeId: string | null
  institutionId: string | null
  personId: string | null
  day: string | null
  kind: KindFilter
  /** Whether the person and institution filters look at presenters only or all authors. */
  peopleMode: PeopleMode
}

export const NO_FILTERS: SearchFilters = {
  query: '',
  themeId: null,
  institutionId: null,
  personId: null,
  day: null,
  kind: 'all',
  peopleMode: 'authors',
}

function kindMatches(p: Presentation, kind: KindFilter): boolean {
  if (kind === 'all') return true
  if (kind === 'posters') return p.kind === 'poster'
  if (kind === 'abstracts') return p.kind === 'oral_abstract' || p.kind === 'video_abstract'
  return ['keynote', 'invited_talk', 'panel', 'award_lecture', 'other'].includes(p.kind)
}

/**
 * Presentations matching every filter, in schedule order. The keyword matches the title,
 * abstract number, any person's name, any institution (including its other spellings), the
 * session title and theme labels, ignoring case, accents and punctuation.
 */
export function searchPresentations(digest: Digest, filters: SearchFilters): Presentation[] {
  const people = new Map(digest.people.map((p) => [p.id, p.display_name]))
  const institutions = new Map(digest.institutions.map((i) => [i.id, [i.canonical_name, ...i.aliases].join(' ')]))
  const sessions = new Map(digest.sessions.map((s) => [s.id, s.title]))
  const themes = new Map(digest.themes.map((t) => [t.id, t.label]))
  const words = normalizeForMatch(filters.query).split(' ').filter(Boolean)

  return countablePresentations(digest)
    .filter((p) => {
      if (filters.themeId && !p.theme_ids.includes(filters.themeId)) return false
      if (filters.day && p.date !== filters.day) return false
      if (!kindMatches(p, filters.kind)) return false
      if (filters.personId && !peopleOf(p, filters.peopleMode).includes(filters.personId)) return false
      if (filters.institutionId && !institutionsOf(digest, p, filters.peopleMode).has(filters.institutionId)) {
        return false
      }
      if (words.length === 0) return true
      const haystack = normalizeForMatch(
        [
          p.title,
          p.abstract_number ?? '',
          ...p.authors.map((a) => people.get(a.person_id) ?? ''),
          ...[...institutionsOf(digest, p, 'authors')].map((id) => institutions.get(id) ?? ''),
          p.session_id ? (sessions.get(p.session_id) ?? '') : '',
          ...p.theme_ids.map((id) => themes.get(id) ?? ''),
        ].join(' '),
      )
      return words.every((w) => ` ${haystack} `.includes(` ${w}`))
    })
    .sort(
      (a, b) =>
        (a.date ?? '9999').localeCompare(b.date ?? '9999') ||
        (a.start_time ?? '99:99').localeCompare(b.start_time ?? '99:99') ||
        (a.room ?? '').localeCompare(b.room ?? '') ||
        // Posters share one time and room, so keep them in the program's numbered order.
        (a.abstract_number ?? '').localeCompare(b.abstract_number ?? '', undefined, { numeric: true }) ||
        a.title.localeCompare(b.title),
    )
}

/** "14:28" -> "2:28 PM" */
export function formatTime(time: string | null): string {
  if (!time) return ''
  const [h = 0, m = 0] = time.split(':').map(Number)
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

/** "2026-10-23" -> "Fri, Oct 23" (read as a calendar date, not shifted by time zone). */
export function formatDay(date: string | null): string {
  if (!date) return 'Date not printed'
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
