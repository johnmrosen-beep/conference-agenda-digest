// The instructions Claude receives. The answer's shape is enforced separately (modelOutput.ts),
// so these prompts focus on judgment: what counts as a session, how to read superscripts,
// what to leave out. They are kept identical across chunks, so results are consistent.

import type { ListedInstitution } from './institutions'
import type { OutlineOutput, OutlineSession } from './modelOutput'

export const INSTITUTIONS_SYSTEM = `You clean up the list of institutions named in a medical conference program, so that each real organization is counted once.

You get a numbered list of names, each already a distinct spelling. Group the numbers that refer to the same organization, and give each group its full official name in English.

Put names in the same group when they are:
- abbreviations or variants of one name ("UAMS" and "University of Arkansas for Medical Sciences"; "CHOP" and "Children's Hospital of Philadelphia")
- a university's own schools, colleges or departments ("Perelman School of Medicine" with "University of Pennsylvania"; "University of Miami Miller School of Medicine" with "University of Miami")
- organizations that have formally merged into one (for example, Rady Children's Health and Children's Hospital of Orange County, CHOC)

Keep names in separate groups when they are:
- a hospital or health system and a university, even when closely affiliated ("Boston Children's Hospital" and "Harvard Medical School"; "Rady Children's Health" and "University of California San Diego")
- different campuses or members of a university system ("University of California San Diego" and "University of California Irvine")
- different organizations that merely share a word ("Children's Hospital Colorado" and "Children's Hospital Los Angeles")

When you are not sure two names are the same organization, keep them apart: a wrong merge is worse than a missed one. Every number must appear in exactly one group; a name with no match is a group of its own.`

export function institutionsUserMessage(listed: ListedInstitution[]): string {
  const lines = listed.map(({ number, institution, mentions }) => {
    const where = [institution.city, institution.country].filter(Boolean).join(', ')
    return `${number}. ${institution.canonical_name}${where ? ` (${where})` : ''} [${mentions}]`
  })
  return `Institutions (with location when known, and [number of times named]):\n${lines.join('\n')}\n\nGroup the numbers that are the same organization.`
}

export const OUTLINE_SYSTEM = `You read the extracted text of a medical conference PDF (a program book or abstract book) and map its structure.

The text is split into pages marked "=== PAGE n ===". Superscript affiliation markers appear as ^1 or ^1,2. Text comes from PDF extraction, so line order can be imperfect and words may be split.

Return:
- The conference's name, dates, venue and location as printed. Write dates as YYYY-MM-DD.
- Every scheduled session: plenaries, symposia, concurrent sessions, oral abstract sessions, poster sessions, workshops, meet-the-professor sessions, industry symposia, business meetings, socials. Use the title as printed, its date, start and end time (24-hour HH:MM), room, moderators, and the page range it covers. A poster session's range runs until the next session header, even across many pages.
- Mark sponsor and industry events, business meetings, socials, meals and breaks as not scientific.
- Leave out committee, board and special-interest-group meetings, registration hours, and speaker-ready-room hours. They are not sessions anyone would add to an agenda.
- Topic headings inside a session (often ALL CAPS, such as "INFLAMMATORY BOWEL DISEASE" between groups of posters) are categories, not sessions. Use them as themes instead.
- A list of 8 to 15 themes covering the scientific content. Reuse the conference's own category headings where it has them.
- Pages with no sessions or presentations at all (covers, sponsor lists, exhibitor lists, credit statements, indexes), so they can be skipped.

Only report what the text supports. Use null for anything not printed. Do not guess dates or times.`

export const DETAIL_SYSTEM = `You extract every presentation from a few pages of a medical conference PDF.

The text is split into pages marked "=== PAGE n ===". Superscript affiliation markers appear as ^1 or ^1,2. In author lists, "Smith^1,2" means Smith has affiliations 1 and 2, and "^1Pediatrics, Example Hospital" is affiliation 1. Text comes from PDF extraction, so line order can be imperfect and words may be split across lines.

A presentation is any talk, keynote, panel, oral abstract, poster or video abstract with a title. For each one:
- Give the page as the number in the nearest "=== PAGE n ===" marker above where the item starts.
- Copy the title exactly as printed, keeping its capitalization. Join a title that wraps across lines.
- List people in printed order, without degrees or markers in the name. Put degrees in credentials.
- For invited talks, keynotes and panels the people are speakers (people_are_speakers true). For abstracts and posters they are an author list (false).
- List each affiliation once with its marker. If a speaker's institution is printed next to their name without a marker, give it marker "1" (then "2" for the next new one) and reference that marker from the person.
- Give a date, time or room only when printed for that item itself; leave them null when they come only from the session header.
- Attach it to the session it belongs to, copying the session title exactly from the outline provided.
- Choose up to 3 themes from the theme list provided, copying the labels exactly.
- Mark withdrawn abstracts as withdrawn and highlighted ones (for example an asterisk explained as "Poster of Distinction") as highlighted.

Only extract items that start on the pages you are asked to extract. A page marked as context is there only to help you understand where an item belongs. Do not include learning objectives, sponsor lists, or session headers as presentations. Never invent anything that is not in the text.`

/** A compact view of the outline: just what a chunk needs to place its items. */
function describeSessions(sessions: OutlineSession[]): string {
  if (sessions.length === 0) return '(no sessions on these pages)'
  return sessions
    .map((s) => {
      const when = [s.date, s.start_time && s.end_time ? `${s.start_time}-${s.end_time}` : s.start_time]
        .filter(Boolean)
        .join(' ')
      return `- "${s.title}" (${s.session_type}; ${when || 'time not printed'}; ${s.room ?? 'room not printed'}; pages ${s.first_page}-${s.last_page})`
    })
    .join('\n')
}

export function outlineUserMessage(documentText: string): string {
  return `${documentText}\n\nMap the structure of this conference document.`
}

export function detailUserMessage(input: {
  outline: OutlineOutput
  chunkText: string
  extractPages: number[]
  contextPages: number[]
}): string {
  const { outline, chunkText, extractPages, contextPages } = input
  const first = Math.min(...extractPages)
  const last = Math.max(...extractPages)
  const sessions = outline.sessions.filter((s) => s.last_page >= first - 1 && s.first_page <= last)
  const themes = outline.themes.map((t) => `- ${t.label}: ${t.description}`).join('\n')
  const context =
    contextPages.length > 0 ? `Page ${contextPages.join(', ')} is context only; do not extract from it.` : ''
  return `Conference: ${outline.conference.name}

Sessions on or near these pages:
${describeSessions(sessions)}

Theme list:
${themes}

${chunkText}

Extract every presentation that starts on pages ${first}-${last}. ${context}`.trim()
}
