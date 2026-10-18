// Turns Claude's answers (one outline plus one answer per chunk) into a single digest.
// This is plain code, no AI, and it's where the bookkeeping happens:
//   - give every session, presentation, person, affiliation and institution an id,
//   - drop duplicates (the same abstract seen by two overlapping chunks),
//   - attach each presentation to its session and copy the session's date, time and room
//     when the presentation has none printed,
//   - merge people and institutions whose names differ only in formatting
//     ("The Bayport Children's Hospital" and "Bayport Childrens Hospital").
// Smarter merging of institution names (using Claude) comes in a later milestone.

import type { Chunk } from './chunk'
import type { ChunkPresentation, OutlineOutput, OutlineSession } from './modelOutput'
import {
  SCHEMA_VERSION,
  type Affiliation,
  type Digest,
  type DigestWarning,
  type Institution,
  type InstitutionType,
  type Person,
  type Presentation,
  type Session,
  type Theme,
} from './schema'
import { normalizeForMatch } from './validate'

export interface ChunkResult {
  chunk: Chunk
  presentations: ChunkPresentation[]
}

export interface MergeInput {
  source: Digest['source']
  outline: OutlineOutput
  chunks: ChunkResult[]
}

// ---------------------------------------------------------------- small helpers

/** Accepts YYYY-MM-DD for a real calendar date; anything else becomes null. */
export function cleanDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value) ? value : null
}

/** Accepts H:MM or HH:MM on a 24-hour clock and returns HH:MM; anything else becomes null. */
export function cleanTime(value: string | null): string | null {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${match[2]}`
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed ? trimmed : null
}

/** The key used to decide that two printed names are the same person. */
export function personKey(name: string): string {
  return normalizeForMatch(name)
}

/**
 * The key used to decide that two printed institution names are the same place. Folds
 * capitalization, accents, apostrophes, a leading "The", and common abbreviations.
 */
export function institutionKey(name: string): string {
  return normalizeForMatch(
    name
      .replace(/&/g, ' and ')
      .replace(/^\s*the\s+/i, '')
      .replace(/\buniv\b\.?/gi, 'university')
      .replace(/\bst\b\.?(?=\s)/gi, 'saint')
      .replace(/\bctr\b\.?/gi, 'center')
      .replace(/\bcentre\b/gi, 'center'),
  )
}

export function guessInstitutionType(name: string): InstitutionType {
  const n = name.toLowerCase()
  if (/children|pediatric|paediatric|kids/.test(n) && /hospital|health|medical center|institute/.test(n)) {
    return 'childrens_hospital'
  }
  if (/universit|college|school of medicine|faculty/.test(n)) return 'university'
  if (/\b(inc|llc|ltd|corp|gmbh)\b|pharma|therapeutics|labs?\b|biosciences?|nutrition company/.test(n)) {
    return 'industry'
  }
  if (/society|association|foundation|academy|federation/.test(n)) return 'society'
  if (/hospital|health|medical center|clinic|institute/.test(n)) return 'health_system'
  return 'other'
}

function pageRange(first: number, last: number, pageCount: number): number[] {
  const start = Math.max(1, Math.min(first, pageCount))
  const end = Math.max(start, Math.min(last, pageCount))
  return Array.from({ length: end - start + 1 }, (_, i) => start + i)
}

// ---------------------------------------------------------------- registries

/** Hands out ids and merges records that share a key. */
class Registry<T extends { id: string }> {
  private byKey = new Map<string, T>()
  readonly items: T[] = []
  constructor(private prefix: string) {}

  get(key: string): T | undefined {
    return this.byKey.get(key)
  }

  add(key: string, make: (id: string) => T): T {
    const existing = this.byKey.get(key)
    if (existing) return existing
    const item = make(`${this.prefix}-${this.items.length + 1}`)
    this.byKey.set(key, item)
    this.items.push(item)
    return item
  }
}

class InstitutionRegistry {
  private registry = new Registry<Institution>('inst')
  /** How often each spelling was seen, to pick the most common one as the canonical name. */
  private spellings = new Map<string, Map<string, number>>()

  add(name: string, city: string | null, country: string | null): Institution {
    const key = institutionKey(name)
    const institution = this.registry.add(key, (id) => ({
      id,
      canonical_name: name,
      aliases: [],
      city,
      country,
      type: guessInstitutionType(name),
    }))
    const counts = this.spellings.get(key) ?? new Map<string, number>()
    counts.set(name, (counts.get(name) ?? 0) + 1)
    this.spellings.set(key, counts)
    return institution
  }

  finish(): Institution[] {
    for (const institution of this.registry.items) {
      const counts = this.spellings.get(institutionKey(institution.canonical_name))
      if (!counts) continue
      const ranked = [...counts].sort((a, b) => b[1] - a[1])
      institution.canonical_name = ranked[0]![0]
      institution.aliases = ranked.slice(1).map(([name]) => name)
    }
    return this.registry.items
  }
}

// ---------------------------------------------------------------- the merge

export interface PageSpan {
  first: number
  last: number
}

/**
 * Works out which pages each session covers. Claude's own page ranges for long poster sessions
 * proved unreliable (Poster Session II stopping after 2 of its 56 pages), so the rule is
 * mechanical: a session runs until the page before the next session header, sharing that page
 * if Claude says it continues onto it. The last session keeps Claude's range.
 */
export function sessionPageSpans(sessions: OutlineSession[], pageCount: number): PageSpan[] {
  const clamp = (n: number) => Math.max(1, Math.min(n, pageCount))
  const headerPages = [...new Set(sessions.map((s) => clamp(s.first_page)))].sort((a, b) => a - b)
  return sessions.map((s) => {
    const first = clamp(s.first_page)
    const nextHeader = headerPages.find((p) => p > first)
    if (nextHeader === undefined) return { first, last: Math.max(first, clamp(s.last_page)) }
    return { first, last: Math.max(first, nextHeader - 1, Math.min(clamp(s.last_page), nextHeader)) }
  })
}

/**
 * The outline's "pages to skip", minus any page inside a session. Claude once listed all 52
 * pages of a poster session as skippable, which silently lost 300 abstracts; a page that belongs
 * to a session is always read.
 */
export function safeSkipPages(outline: OutlineOutput, pageCount: number): number[] {
  const inSession = new Set(
    sessionPageSpans(outline.sessions, pageCount).flatMap((span) =>
      Array.from({ length: span.last - span.first + 1 }, (_, i) => span.first + i),
    ),
  )
  return outline.skip_pages.filter((page) => !inSession.has(page))
}

function findSession(item: ChunkPresentation, spans: PageSpan[], sessions: Session[]): Session | null {
  const onPage = spans
    .map((span, i) => ({ span, session: sessions[i]! }))
    .filter(({ span }) => span.first <= item.page && item.page <= span.last)

  if (item.session_title) {
    const wanted = normalizeForMatch(item.session_title)
    const named = sessions.filter((s) => normalizeForMatch(s.title) === wanted)
    const namedOnPage = named.filter((s) => onPage.some((o) => o.session === s))
    if (namedOnPage.length > 0) return namedOnPage[0]!
    if (named.length > 0) return named[0]!
  }

  if (onPage.length === 1) return onPage[0]!.session
  if (onPage.length > 1) {
    const start = cleanTime(item.start_time)
    const byTime = start
      ? onPage.filter(({ session }) => session.start_time && session.end_time && session.start_time <= start && start < session.end_time)
      : []
    const pool = byTime.length > 0 ? byTime : onPage
    // The most specific match is the session whose header is closest above the item.
    return pool.reduce((best, next) => (next.span.first > best.span.first ? next : best)).session
  }
  return null
}

function dedupeKey(item: ChunkPresentation): string {
  const number = item.abstract_number?.replace(/[^0-9a-z]/gi, '').toLowerCase()
  if (number) return `number:${number}`
  return `title:${normalizeForMatch(item.title)}|${cleanTime(item.start_time) ?? ''}`
}

export function mergeDigest(input: MergeInput): Digest {
  const { outline, source } = input
  const pageCount = source.page_count
  const warnings: DigestWarning[] = []

  const people = new Registry<Person>('person')
  const affiliations = new Registry<Affiliation>('aff')
  const institutions = new InstitutionRegistry()

  const addPerson = (name: string, credentials: string | null): Person => {
    const person = people.add(personKey(name), (id) => {
      const display = name.replace(/\s+/g, ' ').trim()
      return {
        id,
        display_name: display,
        family_name: display.split(' ').at(-1) ?? null,
        credentials: cleanText(credentials),
      }
    })
    if (!person.credentials && credentials) person.credentials = cleanText(credentials)
    return person
  }

  // --- Themes, from the outline ---
  const themes: Theme[] = outline.themes.map((t, i) => ({
    id: `theme-${i + 1}`,
    label: t.label,
    description: t.description || null,
    origin: t.from_document ? 'document' : 'generated',
  }))
  const themeByLabel = new Map(themes.map((t) => [normalizeForMatch(t.label), t.id]))

  // --- Sessions, from the outline ---
  const spans = sessionPageSpans(outline.sessions, pageCount)
  const sessions: Session[] = outline.sessions.map((s, i) => ({
    id: `session-${i + 1}`,
    title: s.title.trim(),
    series: cleanText(s.series),
    session_type: s.session_type,
    is_scientific: s.is_scientific,
    date: cleanDate(s.date),
    start_time: cleanTime(s.start_time),
    end_time: cleanTime(s.end_time),
    room: cleanText(s.room),
    moderator_ids: s.moderators.filter((m) => m.name.trim()).map((m) => addPerson(m.name, m.credentials).id),
    source_category: null,
    source_pages: pageRange(spans[i]!.first, spans[i]!.last, pageCount),
  }))

  // --- Presentations, from every chunk ---
  const seen = new Map<string, number>()
  const presentations: Presentation[] = []
  for (const { chunk, presentations: items } of input.chunks) {
    const chunkPages = new Set([...chunk.contextPages, ...chunk.extractPages])
    for (const rawItem of items) {
      if (!rawItem.title.trim()) continue
      // Items from the context page are kept rather than dropped: Claude sometimes labels an item
      // with the context page's number, and dropping those lost whole pages of abstracts. Any
      // true repeat is removed below by its abstract number or title. A page number outside
      // this chunk is a mistake, so it's replaced with the chunk's first page.
      const item = chunkPages.has(rawItem.page) ? rawItem : { ...rawItem, page: chunk.extractPages[0]! }

      const key = dedupeKey(item)
      const earlier = seen.get(key)
      if (earlier !== undefined && presentations[earlier]!.authors.length >= item.people.length) continue

      const session = findSession(item, spans, sessions)

      // Affiliations of this presentation, by marker.
      const byMarker = new Map<string, Affiliation>()
      const presentationAffiliations: Affiliation[] = []
      item.affiliations.forEach((a, i) => {
        const raw = cleanText(a.raw_text)
        if (!raw) return
        const institutionName = cleanText(a.institution)
        const institution = institutionName
          ? institutions.add(institutionName, null, cleanText(a.country))
          : null
        const affiliation = affiliations.add(normalizeForMatch(raw), (id) => ({
          id,
          raw_text: raw,
          // Department, city and state aren't asked for, to keep answers short (and cheap).
          department: null,
          institution_id: institution?.id ?? null,
          city: null,
          region: null,
          country: cleanText(a.country),
        }))
        byMarker.set(cleanText(a.marker) ?? String(i + 1), affiliation)
        presentationAffiliations.push(affiliation)
      })

      const authors = item.people
        .filter((p) => p.name.trim())
        .map((p, i) => {
          const person = addPerson(p.name, p.credentials)
          let affiliationIds = p.affiliation_markers
            .map((m) => byMarker.get(m.trim())?.id)
            .filter((id): id is string => id !== undefined)
          // Unnumbered single affiliation (common for one-institution abstracts): it applies to everyone.
          if (affiliationIds.length === 0 && presentationAffiliations.length === 1) {
            affiliationIds = [presentationAffiliations[0]!.id]
          }
          return { person_id: person.id, affiliation_ids: [...new Set(affiliationIds)], order: i + 1 }
        })

      const date = cleanDate(item.date)
      const start = cleanTime(item.start_time)
      const end = cleanTime(item.end_time)
      const room = cleanText(item.room)
      const inherit = start === null

      const presentation: Presentation = {
        id: '', // assigned below
        session_id: session?.id ?? null,
        abstract_number: cleanText(item.abstract_number?.replace(/\*+$/, '') ?? null),
        title: item.title.replace(/\s+/g, ' ').trim(),
        // An "oral abstract" inside a poster session is a poster.
        kind: session?.session_type === 'poster_session' && item.kind === 'oral_abstract' ? 'poster' : item.kind,
        award_label: cleanText(item.award_label),
        is_highlighted: item.is_highlighted,
        withdrawn: item.withdrawn,
        date: date ?? session?.date ?? null,
        start_time: start ?? session?.start_time ?? null,
        end_time: inherit ? (session?.end_time ?? null) : end,
        time_inferred:
          (date === null && session?.date != null) ||
          (start === null && session?.start_time != null) ||
          (room === null && session?.room != null),
        room: room ?? session?.room ?? null,
        speaker_ids: item.people_are_speakers ? authors.map((a) => a.person_id) : [],
        authors,
        source_category: cleanText(item.source_category),
        theme_ids: [
          ...new Set(
            item.themes
              .map((label) => themeByLabel.get(normalizeForMatch(label)))
              .filter((id): id is string => id !== undefined),
          ),
        ].slice(0, 3),
        source_pages: [item.page],
      }

      if (earlier !== undefined) {
        presentations[earlier] = presentation // the fuller copy replaces the earlier one
      } else {
        seen.set(key, presentations.length)
        presentations.push(presentation)
      }
    }
  }
  presentations.forEach((p, i) => (p.id = `pres-${i + 1}`))

  if (presentations.length === 0) {
    warnings.push({
      code: 'NO_PRESENTATIONS',
      message: 'No presentations were found in this PDF.',
      ref_id: null,
      pages: [],
    })
  }

  const c = outline.conference
  return {
    schema_version: SCHEMA_VERSION,
    source,
    conference: {
      name: c.name.trim() || source.file_name,
      acronym: cleanText(c.acronym),
      year: c.year ?? Number(cleanDate(c.start_date)?.slice(0, 4) ?? new Date().getFullYear()),
      organizers: c.organizers.map((o) => o.trim()).filter(Boolean),
      start_date: cleanDate(c.start_date),
      end_date: cleanDate(c.end_date),
      venue: cleanText(c.venue),
      city: cleanText(c.city),
      region: cleanText(c.region),
      country: cleanText(c.country),
      summary: null,
      highlights: [],
    },
    sessions,
    presentations,
    people: people.items,
    affiliations: affiliations.items,
    institutions: institutions.finish(),
    themes,
    warnings,
  }
}
