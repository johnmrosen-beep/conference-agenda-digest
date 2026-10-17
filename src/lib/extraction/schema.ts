// The "digest": the one JSON format everything in this app agrees on. The extraction code
// builds it, the charts and search read it, demo mode ships one, and the evaluation harness
// compares a model's digest with a hand-checked "golden" one.
//
// It is written with Zod, a library that describes the shape of data once and gives us both:
//   - a TypeScript type, so the editor catches mistakes while coding, and
//   - a checker that runs on real data, so a malformed digest is caught before the app uses it.
//
// Every record has an `id`. Records point at each other by id (a presentation lists the ids
// of its speakers), the way a database links tables. Ids are made by our code, never by Claude.

import { z } from 'zod'

export const SCHEMA_VERSION = 1

const id = z.string().min(1)
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Dates use YYYY-MM-DD')
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Times use 24-hour HH:MM')
const pageNumbers = z.array(z.number().int().positive())

export const SessionType = z.enum([
  'plenary',
  'symposium',
  'oral_abstracts',
  'poster_session',
  'workshop',
  'meet_the_professor',
  'industry',
  'business_meeting',
  'social',
  'break',
  'other',
])

export const PresentationKind = z.enum([
  'keynote',
  'invited_talk',
  'oral_abstract',
  'poster',
  'video_abstract',
  'panel',
  'award_lecture',
  'other',
])

export const InstitutionType = z.enum([
  'childrens_hospital',
  'university',
  'health_system',
  'industry',
  'society',
  'other',
])

export const Source = z.strictObject({
  file_name: z.string(),
  /** Fingerprint of the PDF file, so a cached digest can be matched to its PDF. */
  sha256: z.string().nullable(),
  page_count: z.number().int().nonnegative(),
  doc_kind: z.enum(['program', 'abstract_book', 'mixed']),
  extracted_with: z
    .strictObject({ model: z.string(), effort: z.string().nullable(), date: isoDate })
    .nullable(),
})

export const Highlight = z.strictObject({
  text: z.string(),
  presentation_ids: z.array(id),
})

export const Conference = z.strictObject({
  name: z.string().min(1),
  acronym: z.string().nullable(),
  year: z.number().int(),
  organizers: z.array(z.string()),
  start_date: isoDate.nullable(),
  end_date: isoDate.nullable(),
  venue: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  /** A short paragraph written by Claude from the finished digest. */
  summary: z.string().nullable(),
  highlights: z.array(Highlight),
})

export const Session = z.strictObject({
  id,
  title: z.string().min(1),
  /** The series it belongs to, such as "Concurrent Session II". */
  series: z.string().nullable(),
  session_type: SessionType,
  /** False for sponsor events, business meetings, socials and breaks, so charts can skip them. */
  is_scientific: z.boolean(),
  date: isoDate.nullable(),
  start_time: clockTime.nullable(),
  end_time: clockTime.nullable(),
  room: z.string().nullable(),
  moderator_ids: z.array(id),
  /** The conference's own heading, copied word for word. */
  source_category: z.string().nullable(),
  source_pages: pageNumbers,
})

export const Author = z.strictObject({
  person_id: id,
  affiliation_ids: z.array(id),
  /** 1 for the first author, 2 for the second, and so on. */
  order: z.number().int().positive(),
})

export const Presentation = z.strictObject({
  id,
  session_id: id.nullable(),
  /** The conference's abstract number, kept as text ("278" or "P-12"). */
  abstract_number: z.string().nullable(),
  title: z.string().min(1),
  kind: PresentationKind,
  /** A prize or named lecture, such as "Young Investigator Award". */
  award_label: z.string().nullable(),
  /** Marked as special by the conference, such as a "Poster of Distinction". */
  is_highlighted: z.boolean(),
  withdrawn: z.boolean(),
  date: isoDate.nullable(),
  start_time: clockTime.nullable(),
  end_time: clockTime.nullable(),
  /** True when the date, time or room was copied from the session because none was printed. */
  time_inferred: z.boolean(),
  room: z.string().nullable(),
  /** Named speakers. Empty for abstracts, whose presenter is the first author (see presenterIds). */
  speaker_ids: z.array(id),
  authors: z.array(Author),
  source_category: z.string().nullable(),
  theme_ids: z.array(id),
  source_pages: pageNumbers,
})

export const Person = z.strictObject({
  id,
  display_name: z.string().min(1),
  family_name: z.string().nullable(),
  /** Degrees as printed, such as "MD, MPH". */
  credentials: z.string().nullable(),
})

export const Affiliation = z.strictObject({
  id,
  /** Exactly as printed, before any cleanup. */
  raw_text: z.string().min(1),
  department: z.string().nullable(),
  institution_id: id.nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
})

export const Institution = z.strictObject({
  id,
  /** The one name used in charts. */
  canonical_name: z.string().min(1),
  /** Other spellings that were merged into this institution. */
  aliases: z.array(z.string()),
  city: z.string().nullable(),
  country: z.string().nullable(),
  type: InstitutionType,
})

export const Theme = z.strictObject({
  id,
  label: z.string().min(1),
  description: z.string().nullable(),
  /** "document" when it comes from the conference's own categories, "generated" otherwise. */
  origin: z.enum(['document', 'generated']),
})

export const DigestWarning = z.strictObject({
  code: z.string(),
  message: z.string(),
  ref_id: id.nullable(),
  pages: pageNumbers,
})

export const Digest = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  source: Source,
  conference: Conference,
  sessions: z.array(Session),
  presentations: z.array(Presentation),
  people: z.array(Person),
  affiliations: z.array(Affiliation),
  institutions: z.array(Institution),
  themes: z.array(Theme),
  warnings: z.array(DigestWarning),
})

export type Digest = z.infer<typeof Digest>
export type Session = z.infer<typeof Session>
export type Presentation = z.infer<typeof Presentation>
export type Author = z.infer<typeof Author>
export type Person = z.infer<typeof Person>
export type Affiliation = z.infer<typeof Affiliation>
export type Institution = z.infer<typeof Institution>
export type Theme = z.infer<typeof Theme>
export type DigestWarning = z.infer<typeof DigestWarning>
export type SessionType = z.infer<typeof SessionType>
export type PresentationKind = z.infer<typeof PresentationKind>
export type InstitutionType = z.infer<typeof InstitutionType>

/**
 * Who counts as the presenter (decided in docs/plan.md): the named speakers for talks, or
 * the first author for abstracts, which don't say who presents.
 */
export function presenterIds(presentation: Presentation): string[] {
  if (presentation.speaker_ids.length > 0) return presentation.speaker_ids
  const first = [...presentation.authors].sort((a, b) => a.order - b.order)[0]
  return first ? [first.person_id] : []
}
