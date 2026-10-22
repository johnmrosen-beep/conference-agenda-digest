// Turns the presentations someone picked into a personal agenda: grouped by day, in time order,
// with an end time for each talk and a note wherever two picks clash. Plain logic, tested in
// tests/agenda.test.ts; agendaPdf.ts draws the result.

import { institutionsOf } from './analysis'
import { presenterIds, type Digest, type Presentation, type Session } from '../extraction/schema'

export interface AgendaItem {
  presentation: Presentation
  session: Session | undefined
  start: string | null
  end: string | null
  /** The end time wasn't printed: it's the next talk's start, the session's end, or +15 minutes. */
  endEstimated: boolean
  /** No time was printed for this item; start and end are the session's hours. */
  timeNotPrinted: boolean
  presenters: string[]
  institutions: string[]
  /** Other picks at the same time in a different room. */
  clashes: { title: string; start: string | null }[]
}

export interface AgendaDay {
  date: string | null
  items: AgendaItem[]
}

function addMinutes(time: string, minutes: number): string {
  const [h = 0, m = 0] = time.split(':').map(Number)
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * When a talk's end isn't printed, it ends when the next talk in its session starts; failing
 * that, when the session ends; failing that, 15 minutes after it starts.
 */
function endOf(p: Presentation, digest: Digest, session: Session | undefined): { end: string | null; estimated: boolean } {
  if (p.end_time && !(p.time_inferred && p.kind !== 'poster')) return { end: p.end_time, estimated: false }
  if (!p.start_time) return { end: null, estimated: false }
  const next = digest.presentations
    .filter((o) => o.session_id === p.session_id && o.id !== p.id && o.start_time && o.start_time > p.start_time! && !o.time_inferred)
    .map((o) => o.start_time!)
    .sort()[0]
  if (next) return { end: next, estimated: true }
  if (session?.end_time && session.end_time > p.start_time) return { end: session.end_time, estimated: true }
  return { end: addMinutes(p.start_time, 15), estimated: true }
}

export function buildAgenda(digest: Digest, pickedIds: Iterable<string>): AgendaDay[] {
  const picked = new Set(pickedIds)
  const sessions = new Map(digest.sessions.map((s) => [s.id, s]))
  const people = new Map(digest.people.map((p) => [p.id, p.display_name]))
  const institutionNames = new Map(digest.institutions.map((i) => [i.id, i.canonical_name]))

  const items: AgendaItem[] = digest.presentations
    .filter((p) => picked.has(p.id))
    .map((p) => {
      const session = p.session_id ? sessions.get(p.session_id) : undefined
      const timeNotPrinted = p.time_inferred && p.kind !== 'poster' && p.start_time === session?.start_time
      const { end, estimated } = endOf(p, digest, session)
      return {
        presentation: p,
        session,
        start: p.start_time,
        end,
        endEstimated: estimated,
        timeNotPrinted,
        presenters: presenterIds(p).map((id) => people.get(id) ?? '').filter(Boolean),
        institutions: [...institutionsOf(digest, p, 'presenters')].map((id) => institutionNames.get(id) ?? '').filter(Boolean),
        clashes: [],
      }
    })
    .sort(
      (a, b) =>
        (a.presentation.date ?? '9999').localeCompare(b.presentation.date ?? '9999') ||
        (a.start ?? '99:99').localeCompare(b.start ?? '99:99') ||
        (a.presentation.abstract_number ?? '').localeCompare(b.presentation.abstract_number ?? '', undefined, { numeric: true }),
    )

  // Clashes: two timed talks on the same day whose times overlap, in different rooms. Posters
  // stand for an hour or more and can be visited around talks, and an item without a printed
  // time can't be placed, so neither counts.
  const timed = items.filter((i) => i.start && i.end && !i.timeNotPrinted && i.presentation.kind !== 'poster')
  for (const a of timed) {
    for (const b of timed) {
      if (a === b || a.presentation.date !== b.presentation.date) continue
      const sameRoom = a.presentation.room !== null && a.presentation.room === b.presentation.room
      if (!sameRoom && a.start! < b.end! && b.start! < a.end!) {
        a.clashes.push({ title: b.presentation.title, start: b.start })
      }
    }
  }

  const days: AgendaDay[] = []
  for (const item of items) {
    const last = days.at(-1)
    if (last && last.date === item.presentation.date) last.items.push(item)
    else days.push({ date: item.presentation.date, items: [item] })
  }
  return days
}
