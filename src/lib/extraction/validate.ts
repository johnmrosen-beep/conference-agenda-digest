// Checks a digest before the app trusts it, in two layers:
//
// 1. Shape (parseDigest): is every field present, of the right type and format? Zod does
//    this from the schema. A digest that fails here is rejected outright.
// 2. Meaning (checkDigest): does the content make sense? Dates inside the conference, start
//    before end, every link pointing at something real, and - when the PDF text is given -
//    every title and name actually printed in the PDF. That last "grounding" check is how we
//    catch a model inventing something. These problems don't reject the digest; each one
//    becomes an issue the app shows with a warning badge, so nothing fails silently.

import { Digest, type Digest as DigestData } from './schema'

export type IssueCode =
  | 'DUPLICATE_ID'
  | 'BROKEN_REFERENCE'
  | 'CONFERENCE_DATES_REVERSED'
  | 'DATE_OUTSIDE_CONFERENCE'
  | 'TIME_ORDER'
  | 'OUTSIDE_SESSION_TIME'
  | 'DUPLICATE_ABSTRACT_NUMBER'
  | 'PAGE_OUT_OF_RANGE'
  | 'MISSING_PRESENTER'
  | 'TITLE_NOT_IN_SOURCE'
  | 'NAME_NOT_IN_SOURCE'

export interface ValidationIssue {
  code: IssueCode
  /** "error": our own assembly code made a mistake. "warning": the content looks doubtful. */
  severity: 'error' | 'warning'
  message: string
  /** The id of the record the issue is about, if any. */
  refId: string | null
  pages: number[]
}

export type ParseResult =
  | { ok: true; digest: DigestData }
  | { ok: false; problems: string[] }

/** Layer 1: checks the shape of data that came from outside (a file, or Claude). */
export function parseDigest(data: unknown): ParseResult {
  const result = Digest.safeParse(data)
  if (result.success) return { ok: true, digest: result.data }
  return {
    ok: false,
    problems: result.error.issues.map((issue) => {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(top level)'
      return `${where}: ${issue.message}`
    }),
  }
}

/**
 * Makes text comparable regardless of formatting: lowercase, accents and superscript markers
 * removed, and every run of punctuation or spacing reduced to one space. "Hos-pital" and
 * "HOSPITAL" then match, and so do "Children’s" and "Childrens".
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/\^[\d,*†‡§¶]+/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/-\s*\n\s*/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * True when `phrase` appears in `text`, tolerating line breaks, hyphenation, accents and
 * punctuation. When the exact phrase isn't found (for example because the PDF stored a title
 * out of order), it still counts if at least 90% of its words of 3+ letters appear.
 */
export function appearsIn(phrase: string, text: string): boolean {
  const needle = normalizeForMatch(phrase)
  if (!needle) return true
  const haystack = normalizeForMatch(text)
  if (` ${haystack} `.includes(` ${needle} `)) return true
  const words = needle.split(' ').filter((w) => w.length >= 3)
  if (words.length < 4) return false
  const present = new Set(haystack.split(' '))
  return words.filter((w) => present.has(w)).length / words.length >= 0.9
}

/** Layer 2: checks that a well-shaped digest also makes sense. */
export function checkDigest(
  digest: DigestData,
  options: { pageTexts?: ReadonlyMap<number, string> } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (
    code: IssueCode,
    severity: ValidationIssue['severity'],
    message: string,
    refId: string | null = null,
    pages: number[] = [],
  ) => issues.push({ code, severity, message, refId, pages })

  // --- Every id is unique, and every link points at a real record ---
  const idSets = {
    session: new Set<string>(),
    presentation: new Set<string>(),
    person: new Set<string>(),
    affiliation: new Set<string>(),
    institution: new Set<string>(),
    theme: new Set<string>(),
  }
  const collections = [
    ['session', digest.sessions],
    ['presentation', digest.presentations],
    ['person', digest.people],
    ['affiliation', digest.affiliations],
    ['institution', digest.institutions],
    ['theme', digest.themes],
  ] as const
  for (const [kind, records] of collections) {
    for (const record of records) {
      if (idSets[kind].has(record.id)) {
        add('DUPLICATE_ID', 'error', `Two ${kind} records share the id "${record.id}".`, record.id)
      }
      idSets[kind].add(record.id)
    }
  }

  const link = (kind: keyof typeof idSets, target: string | null, from: string) => {
    if (target !== null && !idSets[kind].has(target)) {
      add('BROKEN_REFERENCE', 'error', `${from} points at a missing ${kind} "${target}".`, from)
    }
  }
  for (const s of digest.sessions) for (const m of s.moderator_ids) link('person', m, s.id)
  for (const p of digest.presentations) {
    link('session', p.session_id, p.id)
    for (const s of p.speaker_ids) link('person', s, p.id)
    for (const a of p.authors) {
      link('person', a.person_id, p.id)
      for (const aff of a.affiliation_ids) link('affiliation', aff, p.id)
    }
    for (const t of p.theme_ids) link('theme', t, p.id)
  }
  for (const a of digest.affiliations) link('institution', a.institution_id, a.id)
  for (const h of digest.conference.highlights) {
    for (const p of h.presentation_ids) link('presentation', p, 'conference highlight')
  }

  // --- Dates and times ---
  const { start_date: confStart, end_date: confEnd } = digest.conference
  if (confStart && confEnd && confStart > confEnd) {
    add('CONFERENCE_DATES_REVERSED', 'warning', `The conference ends (${confEnd}) before it starts (${confStart}).`)
  }
  const checkWhen = (
    record: { id: string; date: string | null; start_time: string | null; end_time: string | null; source_pages: number[] },
    label: string,
  ) => {
    if (record.date && confStart && confEnd && (record.date < confStart || record.date > confEnd)) {
      add(
        'DATE_OUTSIDE_CONFERENCE',
        'warning',
        `${label} is dated ${record.date}, outside the conference (${confStart} to ${confEnd}).`,
        record.id,
        record.source_pages,
      )
    }
    if (record.start_time && record.end_time && record.start_time >= record.end_time) {
      add(
        'TIME_ORDER',
        'warning',
        `${label} starts at ${record.start_time} but ends at ${record.end_time}.`,
        record.id,
        record.source_pages,
      )
    }
  }
  for (const s of digest.sessions) checkWhen(s, `Session "${s.title}"`)

  const sessionsById = new Map(digest.sessions.map((s) => [s.id, s]))
  for (const p of digest.presentations) {
    checkWhen(p, `"${p.title}"`)
    const session = p.session_id ? sessionsById.get(p.session_id) : undefined
    if (
      session?.start_time &&
      session.end_time &&
      p.start_time &&
      (session.date === null || p.date === null || session.date === p.date) &&
      (p.start_time < session.start_time || p.start_time >= session.end_time)
    ) {
      add(
        'OUTSIDE_SESSION_TIME',
        'warning',
        `"${p.title}" starts at ${p.start_time}, outside its session (${session.start_time} to ${session.end_time}).`,
        p.id,
        p.source_pages,
      )
    }
  }

  // --- Abstract numbers are unique ---
  const byNumber = new Map<string, string>()
  for (const p of digest.presentations) {
    if (p.abstract_number === null) continue
    const earlier = byNumber.get(p.abstract_number)
    if (earlier) {
      add(
        'DUPLICATE_ABSTRACT_NUMBER',
        'warning',
        `Abstract ${p.abstract_number} appears twice ("${earlier}" and "${p.id}").`,
        p.id,
        p.source_pages,
      )
    } else {
      byNumber.set(p.abstract_number, p.id)
    }
  }

  // --- Page numbers exist in the PDF ---
  const pageCount = digest.source.page_count
  for (const record of [...digest.sessions, ...digest.presentations]) {
    const bad = record.source_pages.filter((n) => n > pageCount)
    if (bad.length > 0) {
      add('PAGE_OUT_OF_RANGE', 'warning', `${record.id} cites page ${bad.join(', ')}, but the PDF has ${pageCount} pages.`, record.id, bad)
    }
  }

  // --- Every presentation has someone presenting it ---
  for (const p of digest.presentations) {
    if (!p.withdrawn && p.speaker_ids.length === 0 && p.authors.length === 0) {
      add('MISSING_PRESENTER', 'warning', `"${p.title}" has no speaker or authors.`, p.id, p.source_pages)
    }
  }

  // --- Grounding: titles and names are really printed on the pages cited ---
  const { pageTexts } = options
  if (pageTexts) {
    const peopleById = new Map(digest.people.map((person) => [person.id, person]))
    for (const p of digest.presentations) {
      if (p.source_pages.length === 0) continue
      // Include the next page too, since a title or author list can run onto it.
      const pages = new Set(p.source_pages.flatMap((n) => [n, n + 1]))
      const text = [...pages].map((n) => pageTexts.get(n) ?? '').join('\n')
      if (!appearsIn(p.title, text)) {
        add('TITLE_NOT_IN_SOURCE', 'warning', `The title "${p.title}" wasn't found on page ${p.source_pages.join(', ')}.`, p.id, p.source_pages)
      }
      const personIds = new Set([...p.speaker_ids, ...p.authors.map((a) => a.person_id)])
      for (const personId of personIds) {
        const person = peopleById.get(personId)
        if (!person) continue
        const name = person.family_name ?? person.display_name.split(' ').at(-1) ?? ''
        if (!appearsIn(name, text)) {
          add('NAME_NOT_IN_SOURCE', 'warning', `${person.display_name} wasn't found on page ${p.source_pages.join(', ')}.`, p.id, p.source_pages)
        }
      }
    }
  }

  return issues
}
