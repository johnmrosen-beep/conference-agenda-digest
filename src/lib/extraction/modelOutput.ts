// The exact shapes Claude must answer in. These are sent with each request as "structured
// outputs": the API then guarantees the reply is JSON in this shape, so we never have to
// pick JSON out of a chatty answer.
//
// They are deliberately simpler than the digest (schema.ts): no ids, no cross-links, just
// what is printed on the page. Our own code (merge.ts) turns these answers into a digest.
// Rules of structured outputs that shape this file: every field is required (use null for
// "not printed"), and no length or pattern limits, so formats like YYYY-MM-DD are explained
// in descriptions and checked by our code afterwards.

import { z } from 'zod'
import { PresentationKind, SessionType } from './schema'

const text = z.string()
const maybe = (description: string) => z.string().nullable().describe(description)
const DATE = 'YYYY-MM-DD, or null if not printed'
const TIME = '24-hour HH:MM, or null if not printed'

// ---------------------------------------------------------------- pass 1: the outline

export const OutlinePerson = z.strictObject({
  name: text.describe('Full name without degrees, e.g. "Maya Okonkwo"'),
  credentials: maybe('Degrees as printed, e.g. "MD, MPH"'),
  institution: maybe('Institution as printed next to the name'),
})

export const OutlineSession = z.strictObject({
  title: text.describe('Session title exactly as printed'),
  series: maybe('Series name if printed, e.g. "Concurrent Session II"'),
  session_type: SessionType,
  is_scientific: z
    .boolean()
    .describe('False for sponsor/industry events, business meetings, socials, meals and breaks'),
  date: maybe(DATE),
  start_time: maybe(TIME),
  end_time: maybe(TIME),
  room: maybe('Room or location as printed'),
  moderators: z.array(OutlinePerson),
  first_page: z.number().int().describe('Page where the session header is printed'),
  last_page: z.number().int().describe('Last page holding this session\'s items'),
})

export const OutlineTheme = z.strictObject({
  label: text.describe('Short topic name, e.g. "Inflammatory Bowel Disease"'),
  description: text.describe('One sentence on what belongs in this theme'),
  from_document: z.boolean().describe('True if this is one of the conference\'s own category headings'),
})

export const OutlineOutput = z.strictObject({
  conference: z.strictObject({
    name: text,
    acronym: maybe('Short name, e.g. "NASPGHAN"'),
    year: z.number().int().nullable(),
    organizers: z.array(text),
    start_date: maybe(DATE),
    end_date: maybe(DATE),
    venue: maybe('Hotel or convention center'),
    city: maybe('City'),
    region: maybe('State or province'),
    country: maybe('Country'),
  }),
  doc_kind: z.enum(['program', 'abstract_book', 'mixed']),
  sessions: z.array(OutlineSession),
  themes: z
    .array(OutlineTheme)
    .describe('8 to 15 topics covering the scientific content; reuse the conference\'s own category headings where they exist'),
  skip_pages: z
    .array(z.number().int())
    .describe('Pages with no sessions or presentations: covers, sponsors, exhibitors, credit statements, indexes, ads'),
})

// ---------------------------------------------------------------- pass 2: details per chunk

export const ChunkPerson = z.strictObject({
  name: text.describe('Full name without degrees or superscript markers'),
  credentials: maybe('Degrees as printed'),
  affiliation_markers: z
    .array(text)
    .describe('The affiliation markers after this name, e.g. ["1","2"]; [] if none'),
})

export const ChunkAffiliation = z.strictObject({
  marker: maybe('The printed marker, e.g. "1"; null if affiliations are not numbered'),
  raw_text: text.describe('The affiliation exactly as printed, without its marker'),
  institution: maybe('The institution (hospital, university, company) only'),
  country: maybe('Country'),
})

export const ChunkPresentation = z.strictObject({
  page: z.number().int().describe('Page where this item starts'),
  session_title: maybe('Title of the outline session this belongs to, copied exactly; null if none fits'),
  abstract_number: maybe('Abstract or poster number as printed, without the asterisk'),
  title: text.describe('Title as printed; keep its capitalization'),
  kind: PresentationKind,
  award_label: maybe('Prize or named lecture, e.g. "Young Investigator Award"'),
  is_highlighted: z.boolean().describe('Marked as special, e.g. an asterisk meaning "Poster of Distinction"'),
  withdrawn: z.boolean(),
  date: maybe(`${DATE}. Only if printed for this item itself`),
  start_time: maybe(`${TIME}. Only if printed for this item itself`),
  end_time: maybe(`${TIME}. Only if printed for this item itself`),
  room: maybe('Only if printed for this item itself'),
  people_are_speakers: z
    .boolean()
    .describe('True when the listed people are speakers (talks, keynotes, panels); false when they are an author list (abstracts, posters)'),
  people: z.array(ChunkPerson).describe('Speakers or authors in printed order'),
  affiliations: z.array(ChunkAffiliation),
  source_category: maybe('The category heading this item sits under, copied exactly'),
  themes: z.array(text).describe('Labels from the theme list that fit, best first; at most 3'),
})

export const ChunkOutput = z.strictObject({
  presentations: z.array(ChunkPresentation),
})

export type OutlineOutput = z.infer<typeof OutlineOutput>
export type OutlineSession = z.infer<typeof OutlineSession>
export type OutlinePerson = z.infer<typeof OutlinePerson>
export type OutlineTheme = z.infer<typeof OutlineTheme>
export type ChunkOutput = z.infer<typeof ChunkOutput>
export type ChunkPresentation = z.infer<typeof ChunkPresentation>
export type ChunkPerson = z.infer<typeof ChunkPerson>
export type ChunkAffiliation = z.infer<typeof ChunkAffiliation>
