// Writes the conference overview: a short paragraph and a few highlights. One small Claude call
// over a compact description of the finished digest (not the PDF), so it is cheap.
//
// Highlights must point at real presentations: Claude gets each candidate's id and may only
// cite those ids. Our code drops any highlight that cites an id that doesn't exist.

import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { rankInstitutions, rankThemes, countablePresentations, formatDay, formatTime } from '../digest/analysis'
import { callStructured, type CallRecord, type SpendGuard } from './claude'
import type { Effort, ModelId } from './pricing'
import { presenterIds, type Digest } from './schema'

export const SummaryOutput = z.strictObject({
  summary: z.string().describe('One paragraph of 3 to 5 sentences, plain and factual'),
  highlights: z
    .array(
      z.strictObject({
        text: z.string().describe('One short line naming the item and why it stands out'),
        presentation_ids: z.array(z.string()).describe('Ids from the candidate list only'),
      }),
    )
    .describe('3 to 6 highlights'),
})
export type SummaryOutput = z.infer<typeof SummaryOutput>

export const SUMMARY_SYSTEM = `You write the overview at the top of a digest of a medical conference program, for a clinician deciding what to attend.

Write one plain, factual paragraph (3 to 5 sentences): what the meeting is, when and where, how the program is organized, and the main topics. Then list 3 to 6 highlights, such as keynote and named lectures, prize abstracts, and plenary sessions, citing the ids of the presentations they refer to.

Use only the information given. Do not invent speakers, numbers or claims, and do not praise ("exciting", "must-see").`

/** A compact description of the digest: enough to summarize, small enough to be cheap. */
export function summaryUserMessage(digest: Digest): string {
  const c = digest.conference
  const people = new Map(digest.people.map((p) => [p.id, p.display_name]))
  const countable = countablePresentations(digest)
  const sessionTitles = digest.sessions
    .filter((s) => s.is_scientific)
    .map((s) => `- ${formatDay(s.date)} ${formatTime(s.start_time)}: ${s.title} (${s.session_type})`)
  const candidates = countable
    .filter((p) => p.award_label || ['keynote', 'award_lecture'].includes(p.kind) || p.is_highlighted)
    .slice(0, 60)
    .map((p) => {
      const who = presenterIds(p).map((id) => people.get(id) ?? '').filter(Boolean).join(', ')
      return `- [${p.id}] ${p.title}${p.award_label ? ` | ${p.award_label}` : ''} | ${p.kind}${who ? ` | ${who}` : ''}`
    })
  const kinds = new Map<string, number>()
  for (const p of countable) kinds.set(p.kind, (kinds.get(p.kind) ?? 0) + 1)

  return [
    `Conference: ${c.name}${c.acronym ? ` (${c.acronym})` : ''}`,
    `Dates: ${c.start_date ?? 'not printed'} to ${c.end_date ?? 'not printed'}`,
    `Place: ${[c.venue, c.city, c.region, c.country].filter(Boolean).join(', ') || 'not printed'}`,
    `Presentations by kind: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`,
    `Top themes: ${rankThemes(digest).slice(0, 8).map((t) => `${t.label} (${t.count})`).join(', ')}`,
    `Most represented institutions: ${rankInstitutions(digest, 'presenters').slice(0, 6).map((i) => i.label).join(', ')}`,
    '',
    'Scientific sessions:',
    ...sessionTitles.slice(0, 80),
    '',
    'Highlight candidates (cite these ids):',
    ...(candidates.length > 0 ? candidates : ['(none marked)']),
  ].join('\n')
}

/** Asks Claude for the overview and stores it in the digest, keeping only real citations. */
export async function summarizeDigest(
  digest: Digest,
  options: {
    client: Anthropic
    model: ModelId
    effort: Effort
    guard: SpendGuard
    signal?: AbortSignal
    onText?: (newChars: number) => void
  },
): Promise<{ answer: SummaryOutput; record: CallRecord }> {
  const { data, record } = await callStructured({
    client: options.client,
    model: options.model,
    effort: options.effort,
    system: SUMMARY_SYSTEM,
    user: summaryUserMessage(digest),
    schema: SummaryOutput,
    maxTokens: 8_000,
    guard: options.guard,
    label: 'the summary',
    signal: options.signal,
    onText: options.onText,
  })
  applySummary(digest, data)
  return { answer: data, record }
}

/** Stores a summary answer in the digest. Highlights citing unknown ids lose those ids. */
export function applySummary(digest: Digest, answer: SummaryOutput): void {
  const ids = new Set(digest.presentations.map((p) => p.id))
  digest.conference.summary = answer.summary.trim() || null
  digest.conference.highlights = answer.highlights
    .map((h) => ({ text: h.text.trim(), presentation_ids: h.presentation_ids.filter((id) => ids.has(id)) }))
    .filter((h) => h.text !== '')
    .slice(0, 6)
}
