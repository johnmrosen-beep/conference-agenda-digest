// Merges institution names that mean the same place ("entity resolution").
//
// The merge step already folds simple spelling differences ("The Bayport Children's Hospital" and
// "Bayport Childrens Hospital"). What's left needs knowledge rather than spelling rules: "UAMS" is
// the University of Arkansas for Medical Sciences, and "Perelman School of Medicine" belongs to the
// University of Pennsylvania. One small Claude call looks at the whole list of distinct names at
// once and groups the ones that are the same organization. Our code then checks the answer (every
// name placed exactly once) and applies it.

import { z } from 'zod'
import { callStructured, type CallRecord, type SpendGuard } from './claude'
import type { Effort, ModelId } from './pricing'
import { INSTITUTIONS_SYSTEM, institutionsUserMessage } from './prompts'
import { InstitutionType, type Digest, type Institution } from './schema'
import type Anthropic from '@anthropic-ai/sdk'

/** Claude's answer: groups of list numbers that are one organization. */
export const InstitutionGroups = z.strictObject({
  groups: z.array(
    z.strictObject({
      name: z.string().describe('The clearest of the listed names in this group, copied exactly'),
      type: InstitutionType,
      members: z.array(z.number().int()).describe('List numbers of every name that is this organization'),
    }),
  ),
})
export type InstitutionGroups = z.infer<typeof InstitutionGroups>

export interface ListedInstitution {
  number: number
  institution: Institution
  /** How many author affiliations point at it: a hint for which spelling is most common. */
  mentions: number
}

/** The distinct institutions in a digest, numbered for Claude, most mentioned first. */
export function listInstitutions(digest: Digest): ListedInstitution[] {
  const mentions = new Map<string, number>()
  const byAffiliation = new Map(digest.affiliations.map((a) => [a.id, a.institution_id]))
  for (const p of digest.presentations) {
    for (const author of p.authors) {
      for (const affiliationId of author.affiliation_ids) {
        const id = byAffiliation.get(affiliationId)
        if (id) mentions.set(id, (mentions.get(id) ?? 0) + 1)
      }
    }
  }
  return [...digest.institutions]
    .sort((a, b) => (mentions.get(b.id) ?? 0) - (mentions.get(a.id) ?? 0) || a.canonical_name.localeCompare(b.canonical_name))
    .map((institution, i) => ({ number: i + 1, institution, mentions: mentions.get(institution.id) ?? 0 }))
}

/**
 * Applies Claude's grouping to the digest: one institution per group, every affiliation pointing
 * at its group, and every spelling kept as an alias. Defensive about the answer: a name Claude
 * left out stays on its own, a name placed twice counts only in its first group, and numbers that
 * aren't on the list are ignored. Returns how many institutions there were and are now.
 */
export function applyInstitutionGroups(
  digest: Digest,
  listed: ListedInstitution[],
  answer: InstitutionGroups,
): { before: number; after: number } {
  const byNumber = new Map(listed.map((l) => [l.number, l]))
  const placed = new Set<number>()
  const groups: { name: string; type: Institution['type']; members: ListedInstitution[] }[] = []

  for (const group of answer.groups) {
    const members = group.members
      .filter((n) => byNumber.has(n) && !placed.has(n))
      .map((n) => {
        placed.add(n)
        return byNumber.get(n)!
      })
    if (members.length > 0) groups.push({ name: group.name.trim() || members[0]!.institution.canonical_name, type: group.type, members })
  }
  for (const l of listed) {
    if (!placed.has(l.number)) groups.push({ name: l.institution.canonical_name, type: l.institution.type, members: [l] })
  }

  const newIdFor = new Map<string, string>()
  const institutions: Institution[] = groups.map((group, i) => {
    const id = `inst-${i + 1}`
    const spellings = new Set<string>()
    for (const { institution } of group.members) {
      newIdFor.set(institution.id, id)
      spellings.add(institution.canonical_name)
      for (const alias of institution.aliases) spellings.add(alias)
    }
    // The group's name is a spelling printed in the PDF: Claude's choice when it is one of the
    // printed spellings, otherwise the one used most often. Asking Claude for each group's
    // "full official name" lowered accuracy in evaluation (institution F1 0.98 -> 0.89), because
    // new names that appear nowhere in the program can't be matched or checked.
    const mostMentioned = [...group.members].sort((a, b) => b.mentions - a.mentions)[0]!.institution.canonical_name
    const suggested = [...spellings].find((s) => s.toLowerCase() === group.name.toLowerCase())
    const name = suggested ?? mostMentioned
    spellings.delete(name)
    const first = group.members[0]!.institution
    return {
      id,
      canonical_name: name,
      aliases: [...spellings],
      city: group.members.map((m) => m.institution.city).find((c) => c !== null) ?? first.city,
      country: group.members.map((m) => m.institution.country).find((c) => c !== null) ?? first.country,
      type: group.type,
    }
  })

  for (const affiliation of digest.affiliations) {
    if (affiliation.institution_id) affiliation.institution_id = newIdFor.get(affiliation.institution_id) ?? null
  }
  const before = digest.institutions.length
  digest.institutions = institutions
  return { before, after: institutions.length }
}

/** Asks Claude to group the digest's institutions, then applies the answer. */
export async function resolveInstitutions(
  digest: Digest,
  options: {
    client: Anthropic
    model: ModelId
    effort: Effort
    guard: SpendGuard
    signal?: AbortSignal
    onText?: (newChars: number) => void
  },
): Promise<{ answer: InstitutionGroups; record: CallRecord; before: number; after: number }> {
  const listed = listInstitutions(digest)
  const { data, record } = await callStructured({
    client: options.client,
    model: options.model,
    effort: options.effort,
    system: INSTITUTIONS_SYSTEM,
    user: institutionsUserMessage(listed),
    schema: InstitutionGroups,
    maxTokens: 32_000,
    guard: options.guard,
    label: 'the institution list',
    signal: options.signal,
    onText: options.onText,
  })
  return { answer: data, record, ...applyInstitutionGroups(digest, listed, data) }
}
