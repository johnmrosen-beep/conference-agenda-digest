// The "golden" answer key: for a few pages of a PDF, every presentation and session that is
// really there, with its correct details, checked by a person. A model's digest of the same
// pages is scored against it (see scoring.ts).
//
// The format is deliberately simpler than the digest: names instead of ids, so a person can
// read and correct it in a text editor while looking at the PDF.

import { z } from 'zod'
import { PresentationKind, presenterIds, type Digest } from '../src/lib/extraction/schema'

export const GoldenSession = z.strictObject({
  title: z.string().min(1),
  date: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  room: z.string().nullable(),
})

export const GoldenPresentation = z.strictObject({
  abstract_number: z.string().nullable(),
  title: z.string().min(1),
  kind: PresentationKind,
  /** Title of the session it belongs to, matching one in `sessions`. */
  session_title: z.string().nullable(),
  // What the app should show for this presentation: its own printed time, or the session's
  // when none is printed. Null means "not knowable from the PDF"; such fields aren't scored.
  date: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  room: z.string().nullable(),
  /** Speakers for talks, the first author for abstracts. */
  presenters: z.array(z.string()),
  /** Everyone listed, in printed order. */
  authors: z.array(z.string()),
  /** Canonical names of every institution its people list. */
  institutions: z.array(z.string()),
  page: z.number().int().positive(),
  /** Anything a reviewer wants to remember about this item. */
  note: z.string().nullable(),
})

export const GoldenSlice = z.strictObject({
  id: z.string().min(1),
  description: z.string(),
  /** The PDF pages this slice covers; the model is run on exactly these. */
  pages: z.array(z.number().int().positive()).min(1),
  /** False until a person has checked every item against the PDF. */
  reviewed: z.boolean(),
  sessions: z.array(GoldenSession),
  presentations: z.array(GoldenPresentation),
  /** Canonical institution name -> other spellings that mean the same place. */
  institution_aliases: z.record(z.string(), z.array(z.string())),
})

export type GoldenSlice = z.infer<typeof GoldenSlice>
export type GoldenPresentation = z.infer<typeof GoldenPresentation>
export type GoldenSession = z.infer<typeof GoldenSession>

/**
 * Turns a digest into the golden format. Used to make the demo conference's golden file (the
 * demo digest is correct by construction) and to show a model's answer side by side with
 * the golden one.
 */
export function digestToGolden(digest: Digest, slice: { id: string; description: string; pages: number[] }): GoldenSlice {
  const pages = new Set(slice.pages)
  const people = new Map(digest.people.map((p) => [p.id, p.display_name]))
  const sessions = new Map(digest.sessions.map((s) => [s.id, s]))
  const affiliations = new Map(digest.affiliations.map((a) => [a.id, a]))
  const institutions = new Map(digest.institutions.map((i) => [i.id, i]))

  const inSlice = digest.presentations.filter((p) => p.source_pages.some((n) => pages.has(n)))
  const sessionIds = new Set(inSlice.map((p) => p.session_id).filter((id): id is string => id !== null))

  const aliases: Record<string, string[]> = {}
  for (const institution of digest.institutions) {
    if (institution.aliases.length > 0) aliases[institution.canonical_name] = institution.aliases
  }

  return {
    id: slice.id,
    description: slice.description,
    pages: slice.pages,
    reviewed: true,
    sessions: [...sessionIds].map((id) => {
      const s = sessions.get(id)!
      return { title: s.title, date: s.date, start_time: s.start_time, end_time: s.end_time, room: s.room }
    }),
    presentations: inSlice.map((p) => {
      const institutionNames = new Set<string>()
      for (const author of p.authors) {
        for (const affiliationId of author.affiliation_ids) {
          const institutionId = affiliations.get(affiliationId)?.institution_id
          const institution = institutionId ? institutions.get(institutionId) : undefined
          if (institution) institutionNames.add(institution.canonical_name)
        }
      }
      return {
        abstract_number: p.abstract_number,
        title: p.title,
        kind: p.kind,
        session_title: p.session_id ? (sessions.get(p.session_id)?.title ?? null) : null,
        date: p.date,
        start_time: p.start_time,
        end_time: p.end_time,
        room: p.room,
        presenters: presenterIds(p).map((id) => people.get(id) ?? id),
        authors: [...p.authors].sort((a, b) => a.order - b.order).map((a) => people.get(a.person_id) ?? a.person_id),
        institutions: [...institutionNames],
        page: p.source_pages[0]!,
        note: null,
      }
    }),
    institution_aliases: aliases,
  }
}
